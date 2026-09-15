"use client";

// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Frontend lock state.
//
// The app ships locked: a visitor gets the read-only consultation map.
// Typing the team password (the same SAVE_PASSWORD that guards the save
// routes) unlocks the editing and printing tools for this browser for
// 12 hours. The password is verified server-side and never stored in
// the page — POST /api/auth/unlock sets an httpOnly cookie, and this
// context only ever holds the boolean answer.
//
// `apiAvailable` is false in the static-export (USB stick) build, where
// there are no API routes at all. The lock UI hides itself there rather
// than dangling a button that can't work.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const UNLOCK_URL = "/api/auth/unlock";

// Optimistic render hint. The lock state lives in an httpOnly cookie, so
// the page can only learn it from a round trip — which left an already
// unlocked editor staring at the locked toolbar for ~250 ms on every
// single load, with the nav visibly reflowing when the answer arrived.
//
// This is a HINT ONLY and grants nothing: it just picks the first paint.
// The server answer overwrites it moments later, and every write is
// still gated server-side by the cookie, so a forged hint buys an
// attacker a couple of buttons that 401 the instant they are used.
const UNLOCK_HINT_KEY = "smv-unlock-hint-v1";

function readUnlockHint() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(UNLOCK_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeUnlockHint(unlocked) {
  try {
    if (unlocked) window.localStorage.setItem(UNLOCK_HINT_KEY, "1");
    else window.localStorage.removeItem(UNLOCK_HINT_KEY);
  } catch {}
}

const INITIAL = {
  ready: false,
  unlocked: false,
  // false when the server grants access without a password (local dev
  // with no SAVE_PASSWORD set) — there is nothing to unlock.
  required: true,
  configured: false,
  lockedDown: false,
  apiAvailable: true,
};

const AccessContext = createContext({
  ...INITIAL,
  canEdit: false,
  unlock: async () => ({ ok: false }),
  lock: async () => {},
  refresh: async () => {},
});

export function AccessProvider({ children }) {
  // Starts from INITIAL so the server-rendered and first client-rendered
  // markup agree; the hint is applied in an effect right after mount,
  // before the network answer lands.
  const [state, setState] = useState(INITIAL);

  useEffect(() => {
    if (readUnlockHint()) {
      setState((prev) => (prev.ready ? prev : { ...prev, unlocked: true }));
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(UNLOCK_URL, { cache: "no-store" });
      if (!res.ok) {
        // 404 → static export with no API routes. Anything else →
        // treat as locked; a viewer is the safe failure mode.
        writeUnlockHint(false);
        setState({ ...INITIAL, ready: true, apiAvailable: res.status !== 404 });
        return;
      }
      const data = await res.json();
      writeUnlockHint(Boolean(data.unlocked) && Boolean(data.required));
      setState({
        ready: true,
        apiAvailable: true,
        unlocked: Boolean(data.unlocked),
        required: Boolean(data.required),
        configured: Boolean(data.configured),
        lockedDown: Boolean(data.lockedDown),
      });
    } catch {
      writeUnlockHint(false);
      setState({ ...INITIAL, ready: true, apiAvailable: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const unlock = useCallback(
    async (password) => {
      try {
        const res = await fetch(UNLOCK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || `HTTP ${res.status}` };
        }
        await refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
      }
    },
    [refresh]
  );

  const lock = useCallback(async () => {
    try {
      await fetch(UNLOCK_URL, { method: "DELETE" });
    } catch {}
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ ...state, canEdit: state.unlocked, unlock, lock, refresh }),
    [state, unlock, lock, refresh]
  );

  return (
    <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
  );
}

export function useAccess() {
  return useContext(AccessContext);
}
