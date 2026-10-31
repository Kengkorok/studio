// Studio: editor blog untuk korokk.com
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { bodyLimit } from 'hono/body-limit';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

import { DATA_DIR, listDrafts, getDraft, getDraftByPath, createDraft, updateDraft, deleteDraft } from './db.js';
import { listPosts, readFile as readRepoFile, commit, repoInfo, discussionComments } from './github.js';
import { fromFile, toFile, postPath, postUrl, parsePath, slugify, todayKL, prettyHtml } from './post.js';
import { toWebp, ogCard } from './images.js';
import { toMp4 } from './video.js';
import { requireAccess, authMode } from './access.js';

const SITE = (process.env.SITE_URL || 'https://korokk.com').replace(/\/$/, '');
const KOMEN_API = (process.env.KOMEN_API || '').replace(/\/$/, '');
const PORT = Number(process.env.PORT || 8460);
const HOST = process.env.HOST || '127.0.0.1';
const UPLOADS = join(DATA_DIR, 'uploads');
const ASSETS = join(DATA_DIR, 'assets'); // salinan gambar yang dah diterbit, sementara Pages build
const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const tarikh = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${BULAN[Number(m) - 1]} ${y}`; };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,120}$/;
const TYPES = { webp: 'image/webp', png: 'image/png', mp4: 'video/mp4' };
const hasMedia = (html) => /<(img|video|iframe)\b/.test(html);

// Hantar fail dengan sokongan Range (Safari tak main video tanpanya)
async function sendFile(c, file, headers = {}) {
  const { size } = await stat(file);
  const type = TYPES[file.split('.').pop()] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') || '');
  let start = 0;
  let end = size - 1;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), end); } else start = Math.max(0, size - Number(m[2]));
    if (start > end) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
  }
  const partial = start > 0 || end < size - 1;
  return c.body(Readable.toWeb(createReadStream(file, { start, end })), partial ? 206 : 200, {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    ...headers,
  });
}

const app = new Hono();

app.onError((err, c) => {
  console.error(err);
  return c.json({ ralat: err.message || 'Ralat pelayan' }, err.status && err.status < 500 ? err.status : 500);
});

app.get('/healthz', (c) => c.text('ok'));
app.use('*', requireAccess);

// Elak CSRF: permintaan yang mengubah data mesti datang dari skrip Studio sendiri
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('X-Studio') !== '1') return c.json({ ralat: 'Permintaan ditolak' }, 403);
  return next();
});

app.get('/api/me', (c) => c.json({ email: c.get('email'), repo: repoInfo.repo, site: SITE, komen: !!KOMEN_API, auth: authMode }));

// ---------- Senarai post ----------

app.get('/api/posts', async (c) => {
  const [files, index] = await Promise.all([
    listPosts(),
    fetch(`${SITE}/blog/search.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  const titles = new Map(index.map((p) => [p.url, p.title]));
  const drafts = listDrafts();
  const byPath = new Map(drafts.filter((d) => d.path).map((d) => [d.path, d]));

  const live = files.map((f) => {
    const info = parsePath(f.path);
    if (!info) return null;
    const draft = byPath.get(f.path);
    return {
      path: f.path,
      slug: info.slug,
      date: info.date,
      title: draft?.title || titles.get(`/blog/${info.slug}/`) || info.slug,
      draftId: draft?.id || null,
      dirty: !!draft?.dirty,
      url: `${SITE}/blog/${info.slug}/`,
    };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));

  const livePaths = new Set(files.map((f) => f.path));
  const unpublished = drafts.filter((d) => !d.path || !livePaths.has(d.path));
  return c.json({ live, drafts: unpublished });
});

// Tag yang pernah diguna: dari post yang dah terbit (search.json laman) dan draf dalam Studio
app.get('/api/tags', async (c) => {
  const index = await fetch(`${SITE}/blog/search.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const count = new Map();
  for (const p of index) for (const t of p.tags || []) count.set(t, (count.get(t) || 0) + 1);
  for (const d of listDrafts()) for (const t of d.tags || []) if (!count.has(t)) count.set(t, 0);
  return c.json([...count].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)));
});

// ---------- Draf ----------

app.post('/api/drafts',(c) => c.json(createDraft({ date: todayKL() })));

// Buka post yang dah terbit untuk disunting
app.post('/api/posts/open', async (c) => {
  const { path, reload } = await c.req.json();
  if (!parsePath(path || '')) return c.json({ ralat: 'Path post tak sah' }, 400);
  const existing = getDraftByPath(path);
  if (existing && existing.dirty && !reload) return c.json(existing);
  const { text } = await readRepoFile(path);
  const f = fromFile(path, text);
  const fields = { ...f, body: prettyHtml(f.body), path, slug_locked: true, dirty: false };
  return c.json(existing ? updateDraft(existing.id, fields) : createDraft(fields));
});

app.get('/api/drafts/:id', (c) => {
  const d = getDraft(c.req.param('id'));
  return d ? c.json(d) : c.json({ ralat: 'Draf tiada' }, 404);
});

app.put('/api/drafts/:id', async (c) => {
  const d = getDraft(c.req.param('id'));
  if (!d) return c.json({ ralat: 'Draf tiada' }, 404);
  const b = await c.req.json();
  const f = {};
  for (const k of ['title', 'description', 'image', 'image_alt', 'body']) if (typeof b[k] === 'string') f[k] = b[k];
  for (const k of ['cover', 'komen']) if (typeof b[k] === 'boolean') f[k] = b[k];
  if (Array.isArray(b.tags)) f.tags = [...new Set(b.tags.map((t) => slugify(t)).filter(Boolean))].slice(0, 8);
  if (typeof b.date === 'string' && DATE_RE.test(b.date)) f.date = b.date;
  if (typeof b.slug === 'string') { f.slug = slugify(b.slug); f.slug_locked = true; }
  if (b.slug_locked === false) f.slug_locked = false;
  // Slug ikut tajuk selagi belum diubah sendiri dan post belum pernah terbit
  if (!(f.slug_locked ?? d.slug_locked) && !d.path && 'title' in f) f.slug = slugify(f.title);
  if ('image' in f && f.image !== d.image) f.og_auto = false;
  f.dirty = true;
  return c.json(updateDraft(d.id, f));
});

app.delete('/api/drafts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.json({ ralat: 'ID tak sah' }, 400);
  deleteDraft(id);
  await rm(join(UPLOADS, id), { recursive: true, force: true });
  return c.json({ ok: true });
});

// ---------- Gambar ----------

app.post('/api/drafts/:id/images', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id) || !getDraft(id)) return c.json({ ralat: 'Draf tiada' }, 404);
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ ralat: 'Tiada fail' }, 400);
  if (!/^image\//.test(file.type)) return c.json({ ralat: 'Fail bukan gambar' }, 400);
  let webp;
  try {
    webp = await toWebp(Buffer.from(await file.arrayBuffer()));
  } catch {
    return c.json({ ralat: 'Gambar tak dapat dibaca. Cuba JPG, PNG atau WebP.' }, 400);
  }
  const base = slugify(file.name.replace(/\.[^.]+$/, '')).slice(0, 40) || 'gambar';
  const name = `${base}-${randomBytes(3).toString('hex')}.webp`;
  await mkdir(join(UPLOADS, id), { recursive: true });
  await writeFile(join(UPLOADS, id, name), webp);
  return c.json({ url: `/uploads/${id}/${name}`, size: webp.length });
});

// ---------- Video ----------
// Dihantar dalam cebisan sebab Cloudflare hadkan 100MB setiap permintaan.
// Cebisan terakhir (end=1) mula tukar di belakang; klien tanya status sampai siap.
const VIDEO_MAX = 1024 ** 3;
const jobs = new Map(); // up -> { id, status: 'proses' | 'siap' | 'gagal', result, ralat }

app.post('/api/drafts/:id/video', async (c) => {
  const id = c.req.param('id');
  const up = c.req.query('up') || '';
  if (!ID_RE.test(id) || !getDraft(id)) return c.json({ ralat: 'Draf tiada' }, 404);
  if (!ID_RE.test(up) || jobs.has(up) || !c.req.raw.body) return c.json({ ralat: 'Upload tak sah' }, 400);
  const dir = join(UPLOADS, id);
  const tmp = join(dir, `.up-${up}`);
  await mkdir(dir, { recursive: true });
  const have = await stat(tmp).then((s) => s.size, () => 0);
  if (Number(c.req.query('offset')) !== have) return c.json({ ralat: 'Cebisan video tak ikut turutan. Cuba upload semula.' }, 409);

  let total = have;
  const limit = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      cb(total > VIDEO_MAX ? Object.assign(new Error('Video melebihi 1GB.'), { status: 413 }) : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(c.req.raw.body), limit, createWriteStream(tmp, { flags: 'a' }));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  if (c.req.query('end') !== '1') return c.json({ offset: total });

  const base = slugify(String(c.req.query('name') || '').replace(/\.[^.]+$/, '')).slice(0, 40) || 'video';
  const name = `${base}-${randomBytes(3).toString('hex')}`;
  jobs.set(up, { id, status: 'proses' });
  toMp4(tmp, join(dir, `${name}.mp4`))
    .then(async ({ poster, width, height, size }) => {
      await writeFile(join(dir, `${name}.webp`), poster);
      jobs.set(up, { id, status: 'siap', result: { url: `/uploads/${id}/${name}.mp4`, poster: `/uploads/${id}/${name}.webp`, width, height, size } });
    })
    .catch(async (e) => {
      console.error(e);
      await rm(join(dir, `${name}.mp4`), { force: true });
      jobs.set(up, { id, status: 'gagal', ralat: e.status ? e.message : 'Video tak dapat diproses.' });
    })
    .finally(() => rm(tmp, { force: true }));
  return c.json({ status: 'proses' }, 202);
});

app.get('/api/drafts/:id/video/:up', (c) => {
  const up = c.req.param('up');
  const job = jobs.get(up);
  if (!job || job.id !== c.req.param('id')) return c.json({ ralat: 'Upload tiada' }, 404);
  if (job.status !== 'proses') jobs.delete(up);
  return c.json(job);
});

app.get('/uploads/:id/:file', async (c) => {
  const { id, file } = c.req.param();
  if (!ID_RE.test(id) || !FILE_RE.test(file)) return c.notFound();
  try {
    return await sendFile(c, join(UPLOADS, id, file), { 'Cache-Control': 'private, max-age=31536000, immutable' });
  } catch { return c.notFound(); }
});

// Gambar post sedia ada: guna salinan local kalau baru diterbit, kalau tak ambil dari laman
app.get('/assets/*', async (c) => {
  const rel = decodeURIComponent(c.req.path.slice('/assets/'.length));
  if (rel.split('/').some((p) => !p || p === '..' || p.startsWith('.'))) return c.notFound();
  try {
    return await sendFile(c, join(ASSETS, rel));
  } catch {
    return c.redirect(`${SITE}/assets/${rel}`);
  }
});

app.get('/api/drafts/:id/og.png', async (c) => {
  const d = getDraft(c.req.param('id'));
  if (!d) return c.notFound();
  const png = await ogCard({ title: d.title || 'Tanpa tajuk', date: tarikh(d.date), tags: d.tags });
  return c.body(png, 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
});

// ---------- Terbit ----------

app.post('/api/drafts/:id/publish', async (c) => {
  const d = getDraft(c.req.param('id'));
  if (!d) return c.json({ ralat: 'Draf tiada' }, 404);
  if (!d.title.trim()) return c.json({ ralat: 'Isi tajuk dulu.' }, 400);
  if (!d.slug) return c.json({ ralat: 'Slug kosong.' }, 400);
  if (!DATE_RE.test(d.date)) return c.json({ ralat: 'Tarikh tak sah.' }, 400);
  if (!d.body.replace(/<[^>]+>/g, '').trim() && !hasMedia(d.body)) return c.json({ ralat: 'Isi post masih kosong.' }, 400);

  const newPath = postPath(d);
  if (newPath !== d.path) {
    const clash = (await listPosts()).find((f) => parsePath(f.path)?.slug === d.slug && f.path !== d.path);
    if (clash) return c.json({ ralat: `Slug "${d.slug}" dah digunakan oleh ${clash.path}.` }, 409);
  }

  const dir = `assets/blog/${d.date.slice(0, 4)}/${d.slug}`;
  const files = [];
  const seen = new Set();
  const rewrite = async (s) => {
    const re = new RegExp(`/uploads/${d.id}/([a-z0-9][a-z0-9._-]*\\.(?:webp|mp4))`, 'g');
    for (const [, name] of s.matchAll(re)) {
      if (seen.has(name)) continue;
      seen.add(name);
      files.push({ path: `${dir}/${name}`, content: await readFile(join(UPLOADS, d.id, name)) });
    }
    return s.replace(re, `/${dir}/$1`);
  };

  const body = prettyHtml(await rewrite(d.body)).replace(/(\n?<p><\/p>)+$/, '');
  let image = await rewrite(d.image || '');
  let cover = d.cover;
  let og_auto = d.og_auto;
  if (!image || og_auto) {
    files.push({ path: `${dir}/og.png`, content: await ogCard({ title: d.title, date: tarikh(d.date), tags: d.tags }) });
    image = `/${dir}/og.png`;
    cover = false;
    og_auto = true;
  }

  const content = toFile({ ...d, body, image, cover, og_auto });
  const deletes = d.path && d.path !== newPath ? [d.path] : [];
  const verb = d.path ? 'kemas kini' : 'post';
  const sha = await commit({
    message: `${verb}: ${d.title}\n\nDiterbitkan dari Studio oleh ${c.get('email')}`,
    files: [...files, { path: newPath, content }],
    deletes,
  });

  for (const f of files) {
    const local = join(ASSETS, f.path.slice('assets/'.length));
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, f.content);
  }
  const saved = updateDraft(d.id, { path: newPath, body, image, cover, og_auto, slug_locked: true, dirty: false, published_at: new Date().toISOString() });
  return c.json({ ok: true, commit: sha, url: `${SITE}${postUrl(d)}`, draft: saved });
});

// Tarik balik: buang fail post dari repo, draf kekal dalam Studio
app.post('/api/drafts/:id/unpublish', async (c) => {
  const d = getDraft(c.req.param('id'));
  if (!d?.path) return c.json({ ralat: 'Post ni belum diterbit.' }, 400);
  await commit({ message: `tarik balik: ${d.title}\n\nDari Studio oleh ${c.get('email')}`, deletes: [d.path] });
  return c.json({ ok: true, draft: updateDraft(d.id, { path: null, dirty: true, published_at: null }) });
});

// ---------- Pratonton dengan CSS blog sebenar ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

app.get('/preview/:id', (c) => {
  const d = getDraft(c.req.param('id'));
  if (!d) return c.notFound();
  const words = d.body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const cover = d.image && d.cover && !d.og_auto ? `<figure class="post__cover"><img src="${esc(d.image)}" alt="${esc(d.image_alt)}"></figure>` : '';
  return c.html(`<!doctype html>
<html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pratonton: ${esc(d.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..700&family=Host+Grotesk:wght@400;500&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${SITE}/styles.css"><link rel="stylesheet" href="${SITE}/blog.css">
<style>.studio-bar{position:sticky;top:0;z-index:9;padding:8px 16px;background:#1B1C1E;color:#E8E8E4;font:12px/1.4 "JetBrains Mono",monospace;text-align:center}</style>
</head><body>
<div class="studio-bar">PRATONTON · belum diterbit · ${esc(SITE)}/blog/${esc(d.slug)}/</div>
<header class="nav nav--blog wrap"><div><span class="nav__name">Mohd Safwan Abd Rahman</span><p class="nav__tag mono muted">a.k.a. Korok · Bilal siang, builder malam</p></div></header>
<main><article class="post wrap">
  <header class="post__head">
    <span class="post__back mono">← Semua tulisan</span>
    <p class="post__meta mono muted"><time>${esc(tarikh(d.date))}</time> <span aria-hidden="true">·</span> ${Math.max(1, Math.floor(words / 200))} min baca</p>
    <h1 class="post__title">${esc(d.title || 'Tanpa tajuk')}</h1>
    ${d.description ? `<p class="post__lede">${esc(d.description)}</p>` : ''}
    ${d.tags.length ? `<p class="post__tags mono">${d.tags.map((t) => `<a>#${esc(t)}</a>`).join(' ')}</p>` : ''}
  </header>
  ${cover}
  <div class="prose">${d.body}</div>
</article></main>
</body></html>`);
});

// ---------- Komen (melalui Worker admin API) ----------

async function komen(path, init = {}) {
  if (!KOMEN_API) throw Object.assign(new Error('KOMEN_API belum diset'), { status: 400 });
  const r = await fetch(`${KOMEN_API}/admin/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.KOMEN_ADMIN_TOKEN || ''}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.ralat || `Worker ${r.status}`), { status: r.status === 401 ? 502 : r.status });
  return data;
}

app.get('/api/komen', async (c) => c.json(await komen(`/komen?status=${c.req.query('status') === 'lulus' ? 'lulus' : 'menunggu'}`)));
app.post('/api/komen/:id/lulus', async (c) => c.json(await komen(`/komen/${Number(c.req.param('id'))}/lulus`, { method: 'POST' })));
app.delete('/api/komen/:id', async (c) => c.json(await komen(`/komen/${Number(c.req.param('id'))}`, { method: 'DELETE' })));

// ---------- Statistik ----------

app.get('/api/statistik', async (c) => {
  const [files, index, worker, giscus] = await Promise.all([
    listPosts(),
    fetch(`${SITE}/blog/search.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    KOMEN_API ? komen('/statistik').catch((e) => ({ ralat: e.message })) : { ralat: 'KOMEN_API belum diset dalam .env Studio.' },
    discussionComments().catch(() => null),
  ]);
  const titles = new Map(index.map((p) => [p.url, p.title]));
  const livePaths = new Set(files.filter((f) => parsePath(f.path)).map((f) => f.path));
  const drafts = listDrafts().filter((d) => !d.path || !livePaths.has(d.path)).length;
  return c.json({
    post: { terbit: livePaths.size, draf: drafts },
    ...worker,
    popular: worker.popular?.map((p) => ({ ...p, title: titles.get(p.path) || p.path })),
    giscus,
  });
});

// ---------- Aplikasi ----------

app.use('/*', serveStatic({ root: './public' }));
app.get('*', serveStatic({ path: './public/index.html' }));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Studio jalan di http://${HOST}:${PORT} (auth: ${authMode}, repo: ${repoInfo.repo})`);
});
