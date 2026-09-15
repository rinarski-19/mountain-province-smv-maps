// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Integration tests hit routes that write into public/data/. That directory
// holds 106 MB of real, version-controlled LGU data — an earlier manual test
// run truncated bauko_saved_views.json by POSTing an empty body — so nothing
// here is allowed to leave a file changed.
//
// Snapshot the exact files a test may touch, restore them afterwards, and
// delete any file the test created.

import fs from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DATA } from "./paths.mjs";

export async function guardFiles(fileNames, run) {
  const snapshots = new Map();
  for (const name of fileNames) {
    const target = path.join(PUBLIC_DATA, name);
    try {
      snapshots.set(name, await fs.readFile(target));
    } catch {
      snapshots.set(name, null); // did not exist
    }
  }
  try {
    return await run();
  } finally {
    for (const [name, content] of snapshots) {
      const target = path.join(PUBLIC_DATA, name);
      if (content === null) {
        await fs.rm(target, { force: true });
      } else {
        await fs.writeFile(target, content);
      }
    }
  }
}
