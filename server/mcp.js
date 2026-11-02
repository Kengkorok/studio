// Connector MCP untuk claude.ai (Cowork, chat, phone): Claude tulis draf sebagai Claudrok.
// Auth OAuth 2.1 + PKCE dengan pendaftaran klien dinamik. Halaman kebenaran (/oauth/authorize)
// kekal di belakang Cloudflare Access, jadi hanya Safwan boleh sambung connector baru.
import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_clients (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL DEFAULT '',
    redirect_uris TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    hash       TEXT PRIMARY KEY,   -- sha256 token; token asal tak disimpan
    kind       TEXT NOT NULL,      -- access | refresh
    client_id  TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

const AUTHOR = 'claudrok';
const ACCESS_TTL = 24 * 60 * 60;
const REFRESH_TTL = 90 * 24 * 60 * 60;
// Hanya callback rasmi Claude; klien lain tak boleh dapat kod walaupun berjaya mendaftar
const CALLBACK = /^https:\/\/(claude\.ai|claude\.com)\/api\/mcp\/auth_callback$/;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const sha = (s) => createHash('sha256').update(s).digest('hex');
const b64url = (buf) => buf.toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function issue(clientId) {
  const access = b64url(randomBytes(32));
  const refresh = b64url(randomBytes(32));
  const add = db.prepare('INSERT INTO oauth_tokens (hash, kind, client_id, expires_at) VALUES (?, ?, ?, ?)');
  add.run(sha(access), 'access', clientId, now() + ACCESS_TTL);
  add.run(sha(refresh), 'refresh', clientId, now() + REFRESH_TTL);
  db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').run(now());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh };
}

const tokenRow = (token, kind) =>
  token ? db.prepare('SELECT * FROM oauth_tokens WHERE hash = ? AND kind = ? AND expires_at > ?').get(sha(token), kind, now()) : null;

// ---------- Alat MCP: setiap satu panggil laluan agent sedia ada sebagai Claudrok ----------

const draf = {
  title: { type: 'string', description: 'Tajuk post, maksimum ~80 aksara' },
  description: { type: 'string', description: 'Ringkasan 1-2 ayat, maksimum 200 aksara' },
  markdown: { type: 'string', description: 'Isi post dalam Markdown, tanpa tajuk "#", tanpa senarai tag atau Sumber' },
  tags: { type: 'array', items: { type: 'string' }, description: '3-5 tag huruf kecil, utamakan tag sedia ada dari panduan' },
  sumber: {
    type: 'object',
    properties: { url: { type: 'string' }, title: { type: 'string' } },
    description: 'Link sumber utama, kalau ada',
  },
  cover: {
    type: 'object',
    description: 'Pilih satu: dari_sumber (og:image link sumber), url (gambar https), base64 (fail gambar dari perbualan) atau auto (kad OG Studio).',
    properties: {
      dari_sumber: { type: 'boolean' },
      url: { type: 'string' },
      base64: { type: 'string' },
      auto: { type: 'boolean' },
      alt: { type: 'string', description: 'Terangkan gambar dalam satu ayat BM' },
      kredit: { type: 'string', description: 'Contoh "Gambar: Niantic" atau "Gambar: Safwan"' },
    },
  },
};

const TOOLS = [
  {
    name: 'panduan',
    title: 'Panduan gaya Claudrok',
    description: 'Identiti penulis, panduan gaya tulisan Safwan dan senarai tag blog korokk.com. Panggil sebelum menulis atau mengubah setiap post.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    call: () => ['GET', '/panduan'],
  },
  {
    name: 'buat_draf',
    title: 'Buat draf blog',
    description: 'Hantar draf post baru ke Studio sebagai Claudrok. Draf tidak diterbit; Safwan semak dan terbit sendiri.',
    inputSchema: { type: 'object', properties: draf, required: ['title', 'markdown'] },
    annotations: { destructiveHint: false, idempotentHint: false },
    call: (a) => ['POST', '/drafts', a],
  },
  {
    name: 'baca_draf',
    title: 'Baca draf',
    description: 'Baca draf Claudrok yang sedia ada (isi dalam HTML).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: true },
    call: (a) => ['GET', `/drafts/${encodeURIComponent(a.id)}`],
  },
  {
    name: 'ubah_draf',
    title: 'Ubah draf',
    description: 'Ubah draf Claudrok yang belum diterbit. Hantar medan yang berubah sahaja.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...draf }, required: ['id'] },
    annotations: { destructiveHint: false, idempotentHint: true },
    call: ({ id, ...a }) => ['PUT', `/drafts/${encodeURIComponent(id)}`, a],
  },
];

const ARAHAN = `Kau menulis untuk blog Safwan (korokk.com/blog) sebagai **Claudrok**. Setiap post masuk Studio sebagai draf; Safwan semak dan terbit sendiri.
1. Panggil \`panduan\` dulu dan ikut medan \`gaya\` sepenuhnya.
2. Bila Safwan minta tulis berdasarkan perbualan atau kerja lepas, guna apa yang betul-betul berlaku (dari perbualan, fail atau sumber). Jangan reka pengalaman, angka atau tarikh.
3. Pilih tag dari senarai panduan dulu, kemudian panggil \`buat_draf\`.
4. Lapor dalam BM santai: tajuk, tag, cover, amaran, link pratonton dan link studio.
Draf sahaja. Jangan masukkan email, token, nombor telefon atau maklumat sulit dalam post.`;

export function mcpRoutes({ agent, studioUrl }) {
  const app = new Hono();
  const resourceMeta = `${studioUrl}/.well-known/oauth-protected-resource/mcp`;

  const protectedResource = (c) => c.json({
    resource: `${studioUrl}/mcp`,
    authorization_servers: [studioUrl],
    bearer_methods_supported: ['header'],
    resource_name: 'Studio korokk.com (Claudrok)',
  });
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

  app.get('/.well-known/oauth-authorization-server', (c) => c.json({
    issuer: studioUrl,
    authorization_endpoint: `${studioUrl}/oauth/authorize`,
    token_endpoint: `${studioUrl}/oauth/token`,
    registration_endpoint: `${studioUrl}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  }));

  app.post('/oauth/register', async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (!uris.length || !uris.every((u) => CALLBACK.test(u))) {
      return c.json({ error: 'invalid_redirect_uri', error_description: 'Hanya callback claude.ai dibenarkan' }, 400);
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get().n >= 50) return c.json({ error: 'invalid_client_metadata', error_description: 'Terlalu banyak klien' }, 400);
    const id = b64url(randomBytes(16));
    db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
      .run(id, String(b.client_name || '').slice(0, 80), JSON.stringify(uris), new Date().toISOString());
    return c.json({
      client_id: id,
      client_name: b.client_name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  });

  // Kod kebenaran hidup 5 minit dalam memori; satu kali guna
  const codes = new Map();
  const tokenError = (c, error, desc) => c.json({ error, error_description: desc }, 400);

  app.post('/oauth/token', async (c) => {
    const ct = c.req.header('Content-Type') || '';
    const b = ct.includes('json') ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}));
    c.header('Cache-Control', 'no-store');
    if (b.grant_type === 'authorization_code') {
      const k = codes.get(b.code);
      codes.delete(b.code);
      if (!k || k.exp < Date.now()) return tokenError(c, 'invalid_grant', 'Kod tak sah atau tamat');
      if (k.clientId !== b.client_id || k.redirectUri !== b.redirect_uri) return tokenError(c, 'invalid_grant', 'Klien tak sepadan');
      if (!b.code_verifier || b64url(createHash('sha256').update(String(b.code_verifier)).digest()) !== k.challenge) {
        return tokenError(c, 'invalid_grant', 'PKCE gagal');
      }
      return c.json(issue(k.clientId));
    }
    if (b.grant_type === 'refresh_token') {
      const row = tokenRow(b.refresh_token, 'refresh');
      if (!row || (b.client_id && b.client_id !== row.client_id)) return tokenError(c, 'invalid_grant', 'Refresh token tak sah');
      db.prepare('DELETE FROM oauth_tokens WHERE hash = ?').run(row.hash);
      return c.json(issue(row.client_id));
    }
    return tokenError(c, 'unsupported_grant_type', 'Jenis grant tak disokong');
  });

  // ---------- Halaman kebenaran (di belakang Cloudflare Access) ----------

  const pending = new Map();
  const authorize = new Hono();

  authorize.get('/', (c) => {
    const q = c.req.query();
    const client = q.client_id && db.prepare('SELECT * FROM oauth_clients WHERE id = ?').get(q.client_id);
    if (!client) return c.text('Klien tak dikenali. Buang connector dan tambah semula.', 400);
    if (!JSON.parse(client.redirect_uris).includes(q.redirect_uri)) return c.text('redirect_uri tak sepadan', 400);
    if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge) return c.text('Perlu response_type=code dengan PKCE S256', 400);
    const nonce = b64url(randomBytes(16));
    pending.set(nonce, { clientId: client.id, redirectUri: q.redirect_uri, challenge: q.code_challenge, state: q.state, exp: Date.now() + 10 * 60 * 1000 });
    c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com; frame-ancestors 'none'");
    return c.html(`<!doctype html><html lang="ms"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sambung Claudrok</title>
<style>body{font:17px/1.5 system-ui,sans-serif;background:#f6f1e7;color:#2b211a;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
main{max-width:420px;background:#fffaf0;border:1px solid #e3d8c4;border-radius:14px;padding:28px}h1{font-size:22px;margin:0 0 12px}
p{margin:0 0 12px}.btn{display:flex;gap:10px;margin-top:20px}button{font:inherit;padding:10px 18px;border-radius:10px;border:1px solid #2b211a;cursor:pointer}
button[value=ya]{background:#2b211a;color:#fffaf0}button[value=tidak]{background:transparent}</style>
<main><h1>Sambung ${esc(client.name || 'Claude')} sebagai Claudrok?</h1>
<p>Connector ni boleh baca panduan gaya, buat draf dan ubah draf Claudrok dalam Studio.</p>
<p>Ia <b>tak boleh</b> terbit, padam, atau sentuh post dan draf kau.</p>
<form method="post"><input type="hidden" name="nonce" value="${nonce}"><div class="btn">
<button name="jawapan" value="ya">Benarkan</button><button name="jawapan" value="tidak">Batal</button></div></form></main></html>`);
  });

  authorize.post('/', async (c) => {
    const b = await c.req.parseBody();
    const p = pending.get(b.nonce);
    pending.delete(b.nonce);
    if (!p || p.exp < Date.now()) return c.text('Permintaan tamat. Cuba sambung semula dari Claude.', 400);
    const back = new URL(p.redirectUri);
    if (p.state) back.searchParams.set('state', p.state);
    if (b.jawapan !== 'ya') {
      back.searchParams.set('error', 'access_denied');
      return c.redirect(back.href);
    }
    const code = b64url(randomBytes(32));
    codes.set(code, { ...p, exp: Date.now() + 5 * 60 * 1000 });
    back.searchParams.set('code', code);
    back.searchParams.set('iss', studioUrl);
    return c.redirect(back.href);
  });

  // ---------- Endpoint MCP (Streamable HTTP, tanpa sesi) ----------

  const gagal = new Map();
  app.all('/mcp', async (c) => {
    if (c.req.method !== 'POST') return c.body(null, 405, { Allow: 'POST' });
    const ip = c.req.header('CF-Connecting-IP') || 'local';
    const g = gagal.get(ip);
    if (g && g.n >= 10 && Date.now() - g.t < 15 * 60 * 1000) return c.json({ error: 'Terlalu banyak cubaan' }, 429);
    const row = tokenRow((c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim(), 'access');
    if (!row) {
      gagal.set(ip, { n: g && Date.now() - g.t < 15 * 60 * 1000 ? g.n + 1 : 1, t: Date.now() });
      return c.json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMeta}"` });
    }
    gagal.delete(ip);

    const msg = await c.req.json().catch(() => null);
    if (Array.isArray(msg)) return c.json(rpcError(null, -32600, 'Batch tidak disokong'), 400);
    if (!msg || msg.jsonrpc !== '2.0') return c.json(rpcError(null, -32700, 'JSON-RPC tak sah'), 400);
    if (msg.id === undefined) return c.body(null, 202);   // notifikasi, contohnya notifications/initialized
    return c.json(await handle(msg));
  });

  async function handle({ id, method, params = {} }) {
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1],
          capabilities: { tools: {} },
          serverInfo: { name: 'studio-claudrok', title: 'Studio korokk.com', version: '1.0.0' },
          instructions: ARAHAN,
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS.map(({ call, ...t }) => t) });
      case 'tools/call': {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return rpcError(id, -32602, `Alat tiada: ${params.name}`);
        const [verb, path, body] = tool.call(params.arguments || {});
        // Panggil laluan agent terus dalam proses; c.env.author menggantikan token agent
        const r = await agent.request(path, {
          method: verb,
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        }, { author: AUTHOR });
        const text = await r.text();
        return ok({ content: [{ type: 'text', text }], isError: !r.ok });
      }
      default:
        return rpcError(id, -32601, `Kaedah tak disokong: ${method}`);
    }
  }

  return { app, authorize };
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
