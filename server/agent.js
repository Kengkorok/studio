// Laluan untuk agent AI (Claudrok = Claude, korokGPT = ChatGPT).
// Agent hanya boleh buat dan ubah draf sendiri; terbit tetap dibuat oleh Safwan dalam Studio.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { marked } from 'marked';

import { DATA_DIR, getDraft, createDraft, updateDraft } from './db.js';
import { slugify, todayKL, prettyHtml } from './post.js';
import { toWebp } from './images.js';
import { satukanTag } from '../shared/tags.js';

const NAMA = { claudrok: 'Claudrok', korokgpt: 'korokGPT' };

// AGENT_TOKENS=claudrok:token1,korokgpt:token2
const TOKENS = (process.env.AGENT_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
  const i = pair.indexOf(':');
  return { author: pair.slice(0, i).trim().toLowerCase(), hash: createHash('sha256').update(pair.slice(i + 1).trim()).digest() };
}).filter((t) => NAMA[t.author] && t.hash);

function whoIs(token) {
  if (!token) return null;
  const h = createHash('sha256').update(token).digest();
  return TOKENS.find((t) => timingSafeEqual(t.hash, h))?.author || null;
}

// ---------- Ambil fail dari internet dengan selamat ----------
// Hanya https ke alamat awam: agent tak boleh suruh server baca rangkaian rumah.
const PRIVATE = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^(::1|::)$/, /^f[cd]/i, /^fe[89ab]/i, /^::ffff:/i,
];
async function assertPublic(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Hanya link https dibenarkan');
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => PRIVATE.some((re) => re.test(a.address)))) throw new Error('Alamat tak dibenarkan');
}

async function safeFetch(url, { max, accept }) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const r = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'korokk-studio/1 (+https://korokk.com)', Accept: accept },
    });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { current = new URL(r.headers.get('location'), current).href; continue; }
    if (!r.ok) throw new Error(`Muat turun gagal (${r.status})`);
    if (Number(r.headers.get('content-length') || 0) > max) throw new Error('Fail terlalu besar');
    const chunks = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > max) throw new Error('Fail terlalu besar');
      chunks.push(chunk);
    }
    return { buf: Buffer.concat(chunks), type: r.headers.get('content-type') || '', url: current };
  }
  throw new Error('Terlalu banyak redirect');
}

// og:image dari halaman sumber
async function ogImage(pageUrl) {
  const { buf, url } = await safeFetch(pageUrl, { max: 3 * 1024 * 1024, accept: 'text/html' });
  const html = buf.toString('utf8');
  const m = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i.exec(html);
  const content = m && /content=["']([^"']+)["']/i.exec(m[0]);
  return content ? new URL(content[1].replace(/&amp;/g, '&'), url).href : null;
}

// ---------- Bersihkan HTML dari agent ----------
// Draf tetap disemak sebelum terbit, tapi skrip dan pengendali event dibuang awal-awal.
function sanitize(html) {
  return String(html)
    .replace(/<(script|style|iframe|object|embed|form|textarea|select|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base|noscript|template)\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function agentRoutes({ knownTags, uploads, site, studioUrl }) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const author = whoIs((c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim());
    if (!author) return c.json({ ralat: 'Token agent tak sah' }, 401);
    c.set('author', author);
    return next();
  });

  app.get('/saya', (c) => c.json({ author: c.get('author'), nama: NAMA[c.get('author')], site, studio: studioUrl }));

  // Panduan gaya: fail dalam DATA_DIR boleh diubah tanpa bina semula container
  app.get('/gaya', async (c) => {
    const own = join(DATA_DIR, 'gaya-tulisan.md');
    const text = await readFile(existsSync(own) ? own : join(process.cwd(), 'agent', 'gaya-tulisan.md'), 'utf8');
    return c.body(text, 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });

  app.get('/tags', async (c) => c.json(await knownTags()));

  async function saveCover(id, cover) {
    let buf;
    let from = '';
    if (cover.base64) {
      buf = Buffer.from(String(cover.base64).replace(/^data:[^,]+,/, ''), 'base64');
    } else {
      from = cover.url || (cover.dari_sumber && cover.sumber_url ? await ogImage(cover.sumber_url) : null);
      if (!from) throw new Error('Halaman sumber tiada og:image');
      const r = await safeFetch(from, { max: 15 * 1024 * 1024, accept: 'image/*' });
      if (!/^image\//.test(r.type)) throw new Error('Link cover bukan gambar');
      buf = r.buf;
    }
    const webp = await toWebp(buf);
    const name = `cover-${randomBytes(3).toString('hex')}.webp`;
    await mkdir(join(uploads, id), { recursive: true });
    await writeFile(join(uploads, id, name), webp);
    return { url: `/uploads/${id}/${name}`, from };
  }

  // Medan dari agent -> medan draf. Sama untuk buat baru dan kemas kini.
  async function fields(b, d) {
    const f = {};
    if (b.title != null) f.title = clip(b.title, 160);
    if (b.description != null) f.description = clip(b.description, 200);
    if (b.markdown != null) f.body = prettyHtml(sanitize(marked.parse(String(b.markdown), { gfm: true })));
    else if (b.html != null) f.body = prettyHtml(sanitize(b.html));
    if (Array.isArray(b.tags)) f.tags = satukanTag(b.tags, await knownTags());
    if (b.sumber?.url && /^https?:\/\//.test(b.sumber.url)) { f.sumber_url = clip(b.sumber.url, 500); f.sumber_title = clip(b.sumber.title || '', 160); }
    if (!d.path && f.title) f.slug = slugify(f.title);
    return f;
  }

  async function applyCover(id, b, f) {
    if (!b.cover) return null;
    const cover = { ...b.cover, sumber_url: f.sumber_url || b.sumber?.url };
    if (cover.auto) { Object.assign(f, { image: '', image_alt: '', image_credit: '', og_auto: false }); return null; }
    try {
      const saved = await saveCover(id, cover);
      Object.assign(f, {
        image: saved.url,
        image_alt: clip(cover.alt, 200),
        image_credit: clip(cover.kredit, 160),
        cover: cover.papar !== false,
        og_auto: false,
      });
      return null;
    } catch (e) {
      return `Cover tak dapat diambil (${e.message}). Draf guna kad OG auto.`;
    }
  }

  const reply = (d, amaran) => ({
    id: d.id,
    author: d.author,
    title: d.title,
    slug: d.slug,
    tags: d.tags,
    image: d.image || null,
    studio: `${studioUrl}/#/tulis/${d.id}`,
    pratonton: `${studioUrl}/preview/${d.id}`,
    terbit: d.path ? `${site}/blog/${d.slug}/` : null,
    amaran: amaran.filter(Boolean),
  });

  app.post('/drafts', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
    const b = await c.req.json().catch(() => null);
    if (!b?.title || (b.markdown == null && b.html == null)) return c.json({ ralat: 'Perlu title dan markdown (atau html)' }, 400);
    const author = c.get('author');
    let d = createDraft({ date: todayKL(), author });
    const f = await fields(b, d);
    const amaran = [await applyCover(d.id, b, f)];
    if (Array.isArray(b.tags)) {
      const asal = b.tags.map((t) => slugify(t)).filter(Boolean);
      const tukar = asal.filter((t) => !f.tags.includes(t));
      if (tukar.length) amaran.push(`Tag disatukan dengan tag sedia ada: ${tukar.join(', ')} -> ${f.tags.join(', ')}`);
    }
    d = updateDraft(d.id, { ...f, dirty: true });
    notify(`📝 Draf baru dari **${NAMA[author]}**: ${d.title}\n${studioUrl}/#/tulis/${d.id}`);
    return c.json(reply(d, amaran), 201);
  });

  const own = (c) => {
    const d = getDraft(c.req.param('id'));
    return d && d.author === c.get('author') ? d : null;
  };

  app.get('/drafts/:id', (c) => {
    const d = own(c);
    return d ? c.json({ ...reply(d, []), description: d.description, body: d.body, dirty: d.dirty }) : c.json({ ralat: 'Draf tiada' }, 404);
  });

  // Agent boleh betulkan draf sendiri selagi belum diterbit
  app.put('/drafts/:id', bodyLimit({ maxSize: 25 * 1024 * 1024 }), async (c) => {
    const d = own(c);
    if (!d) return c.json({ ralat: 'Draf tiada' }, 404);
    if (d.path) return c.json({ ralat: 'Post dah diterbit. Minta Safwan sunting dalam Studio.' }, 409);
    const b = await c.req.json().catch(() => ({}));
    const f = await fields(b, d);
    const amaran = [await applyCover(d.id, b, f)];
    return c.json(reply(updateDraft(d.id, { ...f, dirty: true }), amaran));
  });

  return app;
}

function notify(content) {
  const hook = process.env.NOTIFY_WEBHOOK;
  if (!hook) return;
  fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch(() => {});
}

export const agentCount = TOKENS.length;
