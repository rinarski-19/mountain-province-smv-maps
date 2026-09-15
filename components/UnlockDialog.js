"use client";

// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useAccess } from "./AccessContext";

// Password prompt for unlocking the editing + printing tools.
// Deliberately says nothing about who the password belongs to; it is
// one shared team secret, and the failure message never distinguishes
// "no such password" from "wrong password" beyond what the server says.
export default function UnlockDialog({ open, onClose }) {
  const { unlock, configured } = useAccess();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | error
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const formRef = useRef(null);
  useFocusTrap(formRef, open);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setStatus("idle");
    setError("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      // Capture phase + stopPropagation: TopNav also listens on
      // document, and one Escape used to close both the dialog and a nav
      // menu behind it.
      event.stopPropagation();
      onClose?.();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (status === "checking" || !password.trim()) return;
    setStatus("checking");
    setError("");
    const result = await unlock(password);
    if (result.ok) {
      onClose?.();
      return;
    }
    setStatus("error");
    setError(result.error || "Wrong password.");
    // The field is disabled while `status === "checking"`; focusing it
    // before React re-enables it silently does nothing and strands the
    // user (and any screen reader) on <body>. Wait a frame.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  return (
    <div
      className="unlock-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <form
        ref={formRef}
        className="unlock-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-dialog-title"
        onSubmit={submit}
      >
        <h2 className="unlock-dialog__title" id="unlock-dialog-title">
          Unlock editing tools
        </h2>
        <p className="unlock-dialog__blurb">
          Enter the team password to enable printing per barangay or
          municipality, editing unit land values, and editing the field names
          on the printed sheet.
        </p>

        {!configured && (
          <p className="unlock-dialog__warning">
            No password is configured on this deployment. Set{" "}
            <code>SAVE_PASSWORD</code> in the environment first.
          </p>
        )}

        <label className="unlock-dialog__label" htmlFor="unlock-password">
          Password
        </label>
        <input
          id="unlock-password"
          ref={inputRef}
          className="unlock-dialog__input"
          type="password"
          value={password}
          autoComplete="current-password"
          aria-invalid={status === "error" ? "true" : undefined}
          aria-describedby={error ? "unlock-dialog-error" : undefined}
          onChange={(event) => setPassword(event.target.value)}
          disabled={status === "checking"}
        />

        {error && (
          <p className="unlock-dialog__error" role="alert" id="unlock-dialog-error">
            {error}
          </p>
        )}

        <div className="unlock-dialog__actions">
          <button
            type="button"
            className="unlock-dialog__button"
            onClick={() => onClose?.()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="unlock-dialog__button unlock-dialog__button--primary"
            disabled={status === "checking" || !password.trim()}
          >
            {status === "checking" ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
