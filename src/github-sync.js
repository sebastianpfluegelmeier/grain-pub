// GitHub REST API client for asset sync, ported from grain's
// grain-web-app/src/github-sync.js (trimmed to what the asset editor uses).
//
// All calls use a user-supplied fine-grained Personal Access Token with
// `contents: read/write` on a single repo. This module is stateless and
// classic-script friendly (no ES modules so file:// keeps working); it
// exposes a single `GrainSync` global.

(function () {
  const API = "https://api.github.com";
  const ACCEPT = "application/vnd.github+json";
  const API_VERSION = "2022-11-28";

  function authHeaders(token, extra = {}) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT,
      "X-GitHub-Api-Version": API_VERSION,
      ...extra,
    };
  }

  async function gh(token, path, opts = {}) {
    return fetch(`${API}${path}`, {
      ...opts,
      headers: authHeaders(token, opts.headers || {}),
    });
  }

  async function ghJson(token, path, opts = {}) {
    const res = await gh(token, path, opts);
    if (!res.ok) {
      const body = await res.text();
      let msg = body;
      try {
        msg = JSON.parse(body).message ?? body;
      } catch {}
      const err = new Error(`GitHub ${res.status}: ${msg}`);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function bytesToBase64(bytes) {
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    const CHUNK = 0x8000;
    let s = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    const s = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  }

  async function validateToken(token) {
    return ghJson(token, "/user");
  }

  // Returns { sha, tree: [{ path, type, sha, size }] } or null if the repo
  // has no commits on the branch yet.
  async function listTree(token, owner, name, branch = "main") {
    const res = await gh(token, `/repos/${owner}/${name}/git/trees/${branch}?recursive=1`);
    if (res.status === 404 || res.status === 409) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      sha: data.sha,
      tree: (data.tree ?? []).filter((entry) => entry.type === "blob"),
      truncated: data.truncated,
    };
  }

  async function getBlob(token, owner, name, sha) {
    const data = await ghJson(token, `/repos/${owner}/${name}/git/blobs/${sha}`);
    if (data.encoding === "base64") return base64ToBytes(data.content);
    if (data.encoding === "utf-8") return new TextEncoder().encode(data.content);
    throw new Error(`Unknown blob encoding: ${data.encoding}`);
  }

  // Atomically commit a set of file writes (and optional deletions) in a
  // single commit. `files` is [{ path, contentBytes }], `deletes` is
  // [path]. Handles the empty-repo case by creating the first commit.
  async function putTree(token, owner, name, files, message, deletes = [], branch = "main") {
    if (files.length === 0 && deletes.length === 0) {
      throw new Error("putTree: nothing to commit");
    }

    let parentSha = null;
    let baseTreeSha = null;
    const refRes = await gh(token, `/repos/${owner}/${name}/git/refs/heads/${branch}`);
    if (refRes.ok) {
      const refData = await refRes.json();
      parentSha = refData.object.sha;
      const commit = await ghJson(token, `/repos/${owner}/${name}/git/commits/${parentSha}`);
      baseTreeSha = commit.tree.sha;
    } else if (refRes.status !== 404 && refRes.status !== 409) {
      throw new Error(`GitHub ${refRes.status}: ${await refRes.text()}`);
    }

    const treeEntries = [];
    for (const file of files) {
      const blob = await ghJson(token, `/repos/${owner}/${name}/git/blobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: bytesToBase64(file.contentBytes), encoding: "base64" }),
      });
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    for (const path of deletes) {
      treeEntries.push({ path, mode: "100644", type: "blob", sha: null });
    }

    const treeBody = { tree: treeEntries };
    if (baseTreeSha) treeBody.base_tree = baseTreeSha;
    const tree = await ghJson(token, `/repos/${owner}/${name}/git/trees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(treeBody),
    });

    const commitBody = { message, tree: tree.sha };
    if (parentSha) commitBody.parents = [parentSha];
    const commit = await ghJson(token, `/repos/${owner}/${name}/git/commits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(commitBody),
    });

    if (parentSha) {
      await ghJson(token, `/repos/${owner}/${name}/git/refs/heads/${branch}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha: commit.sha }),
      });
    } else {
      await ghJson(token, `/repos/${owner}/${name}/git/refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }

    return { commitSha: commit.sha };
  }

  window.GrainSync = { validateToken, listTree, getBlob, putTree };
})();
