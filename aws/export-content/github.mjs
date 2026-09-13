// Minimal GitHub App client for the content export: App JWT → installation
// token → Git Data API commit. No SDK — the surface is five endpoints and
// the Lambda must stay small. Every call throws on a non-2xx with the
// GitHub message (never the token).
import { createSign } from 'node:crypto';

const API = 'https://api.github.com';

const b64url = (input) => Buffer.from(input).toString('base64url');

// appJwt({ appId, privateKeyPem }) → RS256 JWT valid ~9 minutes (GitHub
// rejects anything over 10; iat is backdated 60s for clock skew).
export function appJwt({ appId, privateKeyPem }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKeyPem);
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}

async function gh(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'uccsite-export-content',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status} ${data?.message || ''}`.trim());
  return data;
}

// installationToken({ appId, privateKeyPem, installationId }) → short-lived token
export async function installationToken({ appId, privateKeyPem, installationId }) {
  const data = await gh(appJwt({ appId, privateKeyPem }), 'POST', `/app/installations/${installationId}/access_tokens`);
  if (!data?.token) throw new Error('GitHub installation token response had no token');
  return data.token;
}

// commitFiles({ token, repo, branch, files: Map<path,text>, changed: [path],
//   message }) → { sha, created } — one commit on `branch` containing every
// path in `changed` (plus manifest.json when present). Creates the branch
// from the repo's default branch if it does not exist yet.
export async function commitFiles({ token, repo, branch, files, changed, message, author }) {
  let ref = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${branch}`);
  let created = false;
  if (!ref) {
    const repoInfo = await gh(token, 'GET', `/repos/${repo}`);
    if (!repoInfo) throw new Error(`repository ${repo} not found or app not installed on it`);
    const base = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${repoInfo.default_branch}`);
    ref = await gh(token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.object.sha });
    created = true;
  }
  const headSha = ref.object.sha;
  const headCommit = await gh(token, 'GET', `/repos/${repo}/git/commits/${headSha}`);

  const paths = [...new Set([...changed, ...(files.has('manifest.json') ? ['manifest.json'] : [])])];
  const tree = [];
  for (const path of paths) {
    const blob = await gh(token, 'POST', `/repos/${repo}/git/blobs`, { content: files.get(path), encoding: 'utf-8' });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const newTree = await gh(token, 'POST', `/repos/${repo}/git/trees`, { base_tree: headCommit.tree.sha, tree });
  const commit = await gh(token, 'POST', `/repos/${repo}/git/commits`, {
    message, tree: newTree.sha, parents: [headSha], ...(author ? { author, committer: author } : {}),
  });
  await gh(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
  return { sha: commit.sha, created };
}

// remoteBlobShas({ token, repo, branch, paths }) → Map<path, sha> for the
// paths present on the branch (absent paths simply have no entry). Uses a
// recursive tree read — one request — so nothing is downloaded.
export async function remoteBlobShas({ token, repo, branch, paths }) {
  const out = new Map();
  const ref = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${branch}`);
  if (!ref) return out;
  const commit = await gh(token, 'GET', `/repos/${repo}/git/commits/${ref.object.sha}`);
  const tree = await gh(token, 'GET', `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  const wanted = new Set(paths);
  for (const entry of tree?.tree || []) {
    if (entry.type === 'blob' && wanted.has(entry.path)) out.set(entry.path, entry.sha);
  }
  if (tree?.truncated) console.warn('[export-content] remote tree listing truncated — some paths may re-commit unchanged');
  return out;
}
