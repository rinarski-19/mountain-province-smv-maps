// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

export const PUBLIC_DATA = path.join(REPO_ROOT, "public", "data");

// Import an app module by repo-relative path, e.g. mod("lib/print-labels.js").
export function mod(relative) {
  return import(path.join(REPO_ROOT, relative));
}
