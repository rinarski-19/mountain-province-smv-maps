// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// One persistence path for every write route.
//
//   - Local dev (NODE_ENV=development)
//       Writes straight into the working tree at public/data/<file>.
//       Same file the runtime reads, so a hot reload shows the change.
//
//   - Production / preview (Vercel, etc.)
//       Commits the file to the configured GitHub repo via the Contents
//       API. The push triggers the git-deploy hook, the site rebuilds,
//       and every browser refreshing picks up the new data. Coworkers
//       running locally `git pull` to sync.
//
// Previously each of /api/{zones,views,landmarks,roads}/save carried its
// own near-identical copy of commitToGithub(); this is that copy, once.

import fs from "node:fs/promises";
import path from "node:path";

// Fetch the current SHA (so GitHub treats this as an update, not a
// create-if-missing), then PUT the new content with that SHA.
export async function commitToGithub({
  token,
  owner,
  repo,
  branch,
  path: repoPath,
  content,
  message,
}) {
  const base = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
    repoPath
  )}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mountain-province-smv-maps",
  };

  // 404 just means the file doesn't exist yet — we create it.
  let existingSha;
  const getRes = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, {
    headers,
    cache: "no-store",
  });
  if (getRes.ok) {
    const meta = await getRes.json();
    existingSha = meta.sha;
  } else if (getRes.status !== 404) {
    const text = await getRes.text();
    throw new Error(`GET ${repoPath} returned ${getRes.status}: ${text}`);
  }

  const putBody = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
  };
  if (existingSha) putBody.sha = existingSha;

  const putRes = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify(putBody),
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`PUT ${repoPath} returned ${putRes.status}: ${text}`);
  }
  const result = await putRes.json();
  return {
    commitSha: result.commit?.sha,
    htmlUrl: result.content?.html_url,
  };
}

// Persist `serialized` to public/data/<fileName>, picking the backend
// from the environment. Returns a Response-ready plain object on
// success; throws with a `status` property on failure so callers can
// map it straight onto an HTTP status.
export async function persistPublicDataFile({ fileName, serialized, message }) {
  const repoPath = `public/data/${fileName}`;

  if (process.env.NODE_ENV === "development") {
    const target = path.join(process.cwd(), "public", "data", fileName);
    try {
      await fs.writeFile(target, serialized, "utf8");
    } catch (e) {
      const err = new Error(`Could not write file: ${e.message}`);
      err.status = 500;
      throw err;
    }
    return { backend: "local-fs", path: repoPath };
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !owner || !repo) {
    const err = new Error(
      "Production save not configured. Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars."
    );
    err.status = 503;
    throw err;
  }

  try {
    const result = await commitToGithub({
      token,
      owner,
      repo,
      branch,
      path: repoPath,
      content: serialized,
      message,
    });
    return {
      backend: "github",
      path: repoPath,
      commit: result.commitSha,
      url: result.htmlUrl,
    };
  } catch (e) {
    const err = new Error(`GitHub commit failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
}
