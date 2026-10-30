// Baca post dari repo dan commit beberapa fail sekali gus melalui GitHub API.
const API = 'https://api.github.com';
const REPO = process.env.GITHUB_REPO || 'Kengkorok/Kengkorok.github.io';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN belum diset dalam .env');
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'korok-studio',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    const err = new Error(`GitHub ${r.status}: ${msg.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

export const repoInfo = { repo: REPO, branch: BRANCH };

// Senarai fail dalam _posts (nama + sha)
export async function listPosts() {
  try {
    const items = await gh(`/repos/${REPO}/contents/_posts?ref=${BRANCH}`);
    return items.filter((f) => f.type === 'file').map((f) => ({ path: f.path, sha: f.sha }));
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

export async function readFile(path) {
  const f = await gh(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`);
  return { text: Buffer.from(f.content, 'base64').toString('utf8'), sha: f.sha };
}

/**
 * Satu commit untuk semua perubahan.
 * files: [{ path, content: string|Buffer }]  deletes: [path]
 */
export async function commit({ message, files = [], deletes = [] }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const base = await gh(`/repos/${REPO}/git/commits/${ref.object.sha}`);

    const tree = [];
    for (const f of files) {
      const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
      const blob = await gh(`/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
      });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });

    const newTree = await gh(`/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: base.tree.sha, tree }),
    });
    const c = await gh(`/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [base.sha] }),
    });
    try {
      await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: c.sha, force: false }),
      });
      return c.sha;
    } catch (e) {
      // Ada commit lain masuk serentak: ulang dari ref terbaru
      if (e.status !== 422 || attempt === 2) throw e;
    }
  }
}

// Bilangan komen giscus (GitHub Discussions), termasuk balasan.
// Perlukan permission Discussions: Read pada token; null kalau tiada akses.
export async function discussionComments() {
  const [owner, name] = REPO.split('/');
  const query = `query($owner: String!, $name: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      discussions(first: 100, after: $after) {
        nodes { comments(first: 100) { totalCount nodes { replies { totalCount } } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
  let total = 0;
  let after = null;
  for (let page = 0; page < 20; page++) {
    const r = await gh('/graphql', { method: 'POST', body: JSON.stringify({ query, variables: { owner, name, after } }) });
    const d = r.data?.repository?.discussions;
    if (r.errors?.length || !d) return null;
    for (const n of d.nodes) total += n.comments.totalCount + n.comments.nodes.reduce((s, c) => s + c.replies.totalCount, 0);
    if (!d.pageInfo.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return total;
}
