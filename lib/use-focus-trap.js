"use client";

// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Focus management for the app's two modal surfaces (the unlock dialog
// and the print workbench).
//
// Both declare `aria-modal="true"`, which promises assistive tech that
// the rest of the page is inert — but that attribute does nothing on its
// own. Without this hook, Tab walked straight out of the dialog into the
// map and the top nav behind it, and closing the dialog dropped focus on
// <body> instead of returning it to the control that opened it.

import { useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

export function useFocusTrap(containerRef, active) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember what to hand focus back to on close.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (event) => {
      if (event.key !== "Tab") return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      // Wrap at both ends, and pull focus back in if it has escaped
      // (which it can, since the background is not truly inert).
      if (!container.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Listen on the document, not the container: if focus is outside the
    // dialog when Tab is pressed — the moment before autofocus lands, or
    // after a stray click on the page behind — a container-scoped
    // listener never fires and the trap does nothing. The handler pulls
    // focus back in rather than assuming it is already inside.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Only restore if focus is still inside (or lost to body) — never
      // yank it away from somewhere the user has since clicked.
      const active_ = document.activeElement;
      if (
        previouslyFocused?.isConnected &&
        (active_ === document.body || container.contains(active_))
      ) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, active]);
}
