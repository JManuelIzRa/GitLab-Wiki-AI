import { useEffect, useRef, useState } from "react";
import { API_BASE, api } from "../api/client";

/**
 * Tracks a background indexing job until it reaches a terminal state (done or failed).
 *
 * Primary transport: Server-Sent Events via /api/jobs/{jobId}/stream — the server pushes
 * each state change instantly, so no wasted round-trips and no artificial delay.
 *
 * Fallback: If the EventSource errors before receiving a single message (proxy or browser
 * blocks streaming), we switch to the original adaptive polling strategy (1.5 s for the
 * first 15 s, then 3 s) so the UI never gets stuck.
 */
export function useJobPolling(jobId) {
  const [job, setJob] = useState(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!jobId) return;
    cancelRef.current = false;
    let receivedFirstEvent = false;

    // --- SSE path ---
    const es = new EventSource(`${API_BASE}/api/jobs/${jobId}/stream`);

    es.onmessage = (event) => {
      if (cancelRef.current) return;
      receivedFirstEvent = true;
      try {
        const data = JSON.parse(event.data);
        setJob(data);
        if (data.status === "done" || data.status === "failed") {
          es.close();
        }
      } catch {
        // malformed event — ignore, keep connection alive
      }
    };

    es.onerror = () => {
      es.close();
      if (cancelRef.current) return;
      if (receivedFirstEvent) {
        // Connection dropped mid-stream — mark failed so the UI can react.
        setJob((prev) => ({
          ...(prev || {}),
          status: "failed",
          error_message: "Se perdió la conexión con el servidor.",
        }));
        return;
      }
      // Never got a message — SSE probably blocked. Fall back to polling.
      _startPolling();
    };

    // --- Polling fallback ---
    const startTimeRef = { current: Date.now() };

    const _startPolling = () => {
      const poll = async () => {
        if (cancelRef.current) return;
        try {
          const data = await api.getJobStatus(jobId);
          if (cancelRef.current) return;
          setJob(data);
          if (data.status === "done" || data.status === "failed") return;
        } catch (err) {
          if (cancelRef.current) return;
          setJob((prev) => ({ ...(prev || {}), status: "failed", error_message: err.message }));
          return;
        }
        const elapsed = Date.now() - startTimeRef.current;
        const delay = elapsed < 15_000 ? 1_500 : 3_000;
        setTimeout(poll, delay);
      };
      poll();
    };

    return () => {
      cancelRef.current = true;
      es.close();
    };
  }, [jobId]);

  return job;
}
