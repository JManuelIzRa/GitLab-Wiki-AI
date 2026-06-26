import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/**
 * Polls a job until it reaches a terminal state (done or failed).
 * Uses an adaptive interval: fast (1.5s) for the first 15s, then slow (3s).
 * Uses recursive setTimeout rather than setInterval so the interval can change
 * between polls and so a slow network response doesn't cause overlapping requests.
 */
export function useJobPolling(jobId) {
  const [job, setJob] = useState(null);
  const cancelRef = useRef(false);
  const startTimeRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    cancelRef.current = false;
    startTimeRef.current = Date.now();

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

    return () => {
      cancelRef.current = true;
    };
  }, [jobId]);

  return job;
}
