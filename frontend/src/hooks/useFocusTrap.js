import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus within the returned ref's element while active.
 * On deactivation / unmount, returns focus to the element that had it before.
 *
 * @param {boolean} active - Pass `open` for always-mounted modals; omit (defaults to true)
 *   for components that are only in the tree while visible.
 */
export function useFocusTrap(active = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previousFocus = document.activeElement;
    const focusable = () => Array.from(container.querySelectorAll(FOCUSABLE));
    focusable()[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [active]);

  return ref;
}
