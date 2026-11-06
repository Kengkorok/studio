// Feed idea kandungan: tarik berita dari RSS, Threads (melalui RSSHub), Google News dan Leek Duck,
// kemudian Claude Haiku terjemah tajuk ke BM dan ringkas dalam 15 patah perkataan.
import Anthropic from '@anthropic-ai/sdk';
import { XMLParser } from 'fast-xml-parser';
import { Hono } from 'hono';
import { db } from './db.js';

const RSSHUB = (process.env.RSSHUB_URL || 'http://rsshub:1200').replace(/\/$/, '');
const MODEL = 'claude-haiku-5-5';
const SELANG_MIN = 30;     // tarik semua sumber setiap 30 minit
const SIMPAN_HARI = 14;    // item lebih lama dibuang (kecuali tiada)
const BARU_HARI = 4;       // item lebih lama dari ni tak diambil langsung
const MAX_PERKATAAN = 15;
const KELOMPOK = 20;       // item setiap panggilan Claude
const UA = 'Mozilla/5.0 (X11; Linux x86_64) StudioFeed/1.0 (+https://korokk.com)';
const JENIS = ['rss', 'threads', 'google', 'leekduck'];

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS feed_kategori (
    id      INTEGER PRIMARY KEY,
    nama    TEXT NOT NULL,
    susunan INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS feed_sumber (
    id          INTEGER PRIMARY KEY,
    kategori_id INTEGER NOT NULL REFERENCES feed_kategori(id) ON DELETE CASCADE,
    nama        TEXT NOT NULL,
    jenis       TEXT NOT NULL,             -- rss, threads, google, leekduck
    alamat      TEXT NOT NULL DEFAULT '',  -- URL feed, nama pengguna Threads atau kata kunci
    tapis       TEXT NOT NULL DEFAULT '',  -- arahan untuk Claude: berita jenis apa yang diambil
    buang       TEXT NOT NULL DEFAULT '',  -- kata kunci (koma) yang terus dibuang
    aktif       INTEGER NOT NULL DEFAULT 1,
    ralat       TEXT,
    semak_at    TEXT
  );
  CREATE TABLE IF NOT EXISTS feed_item (
    id         INTEGER PRIMARY KEY,
    sumber_id  INTEGER NOT NULL REFERENCES feed_sumber(id) ON DELETE CASCADE,
    guid       TEXT NOT NULL,
    url        TEXT NOT NULL,
    tajuk_asal TEXT NOT NULL,
    petikan    TEXT NOT NULL DEFAULT '',
    terbit_at  TEXT NOT NULL,
    tajuk      TEXT,
    ringkasan  TEXT,
    status     TEXT NOT NULL DEFAULT 'baru', -- baru (belum diterjemah), siap, buang
    cuba       INTEGER NOT NULL DEFAULT 0,
    dibuat_at  TEXT NOT NULL,
    UNIQUE (sumber_id, guid)
  );
  CREATE INDEX IF NOT EXISTS feed_item_status ON feed_item(status, terbit_at);
  CREATE TABLE IF NOT EXISTS feed_tetapan (kunci TEXT PRIMARY KEY, nilai TEXT);
`);

const now = () => new Date().toISOString();
const tetapan = (k) => db.prepare('SELECT nilai FROM feed_tetapan WHERE kunci = ?').get(k)?.nilai ?? null;
const setTetapan = (k, v) => db.prepare('INSERT INTO feed_tetapan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').run(k, v);

// ---------- Sumber asal (sekali sahaja, bila jadual masih kosong) ----------

const BUANG_POKEMON = 'TCG, Trading Card, Pokémon Unite, Pokemon Unite, TCG Pocket';
const AWAL = [
  ['Teknologi', [
    ['Claude (Threads)', 'threads', 'claudeai', 'Berita dan kemas kini produk Claude atau Anthropic.', ''],
    ['Zakwan Termizi (Threads)', 'threads', 'zakwan77__', 'Berita atau tips tentang Hermes Agent dan AI sahaja. Abaikan sembang, promosi dan link referral.', ''],
    ['OpenAI', 'rss', 'https://openai.com/news/rss.xml', '', ''],
    ['The Verge: AI', 'rss', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', '', ''],
    ['9to5Mac', 'rss', 'https://9to5mac.com/feed/', 'Berita iPhone, iOS dan produk utama Apple sahaja.', 'deal, deals, sale'],
    ['MacRumors', 'rss', 'https://www.macrumors.com/macrumors.xml', 'Berita iPhone, iOS dan produk utama Apple sahaja.', 'deal, deals'],
  ]],
  ['Hiburan', [
    ['Pokémon GO (rasmi)', 'rss', 'https://pokemongolive.com/feed', '', ''],
    ['Leek Duck: event', 'leekduck', '', 'Event Pokémon GO.', 'Raid Hour, Spotlight Hour, Max Monday'],
    ['Pokémon Global News (Threads)', 'threads', 'pokemonglobalnews', 'Berita game Pokémon. Abaikan kad TCG, Pokémon Unite dan post tanpa maklumat.', BUANG_POKEMON],
    ['Nintendo Life', 'rss', 'https://www.nintendolife.com/feeds/latest', 'Berita Nintendo dan game Pokémon. Abaikan kad TCG dan Pokémon Unite.', BUANG_POKEMON],
    ['Push Square (PS5)', 'rss', 'https://www.pushsquare.com/feeds/latest', 'Berita PS5 dan PlayStation yang penting sahaja.', ''],
    ['Pokémon Pokopia', 'google', '"Pokopia"', '', BUANG_POKEMON],
    ['Pokémon Scarlet & Violet', 'google', '"Pokemon Scarlet" OR "Pokemon Violet"', '', BUANG_POKEMON],
  ]],
  ['Agama', [
    ['Mufti WP: Irsyad Fatwa', 'rss', 'https://muftiwp.gov.my/ms/artikel/irsyad-fatwa/irsyad-fatwa-umum?format=feed&type=rss', '', ''],
    ['Mufti WP: Bayan Linnas', 'rss', 'https://muftiwp.gov.my/ms/artikel/bayan-linnas?format=feed&type=rss', '', ''],
  ]],
  ['Isu Semasa', [
    ['Astro Awani', 'rss', 'https://news.google.com/rss/search?q=site:astroawani.com+when:2d&hl=ms&gl=MY&ceid=MY:ms', 'Isu semasa dan berita nasional. Abaikan sukan.', ''],
    ['Berita Harian', 'rss', 'https://www.bharian.com.my/feed', 'Isu semasa dan berita nasional. Abaikan sukan, hiburan dan "berita popular hari ini".', ''],
  ]],
];

if (!db.prepare('SELECT COUNT(*) n FROM feed_kategori').get().n) {
  AWAL.forEach(([nama, sumber], i) => {
    const { lastInsertRowid: kid } = db.prepare('INSERT INTO feed_kategori (nama, susunan) VALUES (?, ?)').run(nama, i);
    for (const s of sumber) db.prepare('INSERT INTO feed_sumber (kategori_id, nama, jenis, alamat, tapis, buang) VALUES (?, ?, ?, ?, ?, ?)').run(kid, ...s);
  });
}

// ---------- Baca feed ----------

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, htmlEntities: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const teks = (v) => (v == null ? '' : typeof v === 'object' ? teks(v['#text']) : String(v)).trim();
const ENTITI = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const bersih = (s, max = 600) => String(s || '')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITI[e.toLowerCase()] ?? m))
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

function bacaXml(text) {
  const x = xml.parse(text);
  if (x.rss || x['rdf:RDF']) {
    const items = x.rss ? x.rss.channel?.item : x['rdf:RDF'].item;
    return arr(items).map((i) => ({
      guid: teks(i.guid) || teks(i.link),
      url: teks(i.link),
      tajuk: teks(i.title),
      petikan: teks(i.description) || teks(i['content:encoded']),
      masa: teks(i.pubDate) || teks(i['dc:date']),
      sumber: teks(i.source),
    }));
  }
  if (x.feed) {
    return arr(x.feed.entry).map((e) => {
      const links = arr(e.link);
      const l = links.find((k) => !k['@rel'] || k['@rel'] === 'alternate') || links[0];
      return { guid: teks(e.id), url: l?.['@href'] || '', tajuk: teks(e.title), petikan: teks(e.summary) || teks(e.content), masa: teks(e.published) || teks(e.updated) };
    });
  }
  throw new Error('Bukan feed RSS atau Atom');
}

async function ambil(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8' }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

const googleUrl = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=en-MY&gl=MY&ceid=MY:en`;

// Leek Duck tiada RSS: baca senarai event terus dari halaman /events/
async function leekDuck() {
  const html = await ambil('https://leekduck.com/events/');
  const re = /data-event-occurrence-id="([^"]+)"[^>]*?data-event-start-date-check="([^"]*)"[\s\S]*?href="(\/events\/[^"]+)"[\s\S]*?<span class="event-tag-badge">([^<]*)<\/span>\s*<h2>([\s\S]*?)<\/h2>/g;
  const items = [];
  for (const [, id, mula, href, jenis, tajuk] of html.matchAll(re)) {
    const t = Date.parse(mula);
    // Event yang dah lama bermula atau masih jauh tak diambil
    if (!Number.isFinite(t) || t < Date.now() - 2 * 864e5 || t > Date.now() + 10 * 864e5) continue;
    items.push({ guid: id, url: `https://leekduck.com${href}`, tajuk: bersih(tajuk, 300), petikan: `${jenis}. Bermula ${mula.slice(0, 16).replace('T', ' ')}.`, masa: new Date(Math.min(t, Date.now())).toISOString() });
  }
  if (!items.length && !html.includes('event-item-link')) throw new Error('Susun atur halaman Leek Duck berubah');
  return items;
}

async function bacaSumber(s) {
  if (s.jenis === 'leekduck') return leekDuck();
  const url = s.jenis === 'threads' ? `${RSSHUB}/threads/${encodeURIComponent(s.alamat)}`
    : s.jenis === 'google' ? googleUrl(s.alamat)
    : s.alamat;
  let items = bacaXml(await ambil(url));
  if (s.jenis === 'threads') items = items.map((i) => ({ ...i, tajuk: i.tajuk.replace(/^@[\w.]+:\s*/, '') }));
  // Google News letak " - Nama Sumber" di hujung tajuk
  if (/news\.google\.com/.test(url)) items = items.map((i) => ({ ...i, tajuk: i.sumber && i.tajuk.endsWith(` - ${i.sumber}`) ? i.tajuk.slice(0, -(i.sumber.length + 3)) : i.tajuk }));
  return items;
}

const katakunci = (s) => s.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);

async function tarikSumber(s) {
  try {
    const items = (await bacaSumber(s))
      .map((i) => { const t = Date.parse(i.masa); return { ...i, t: Number.isFinite(t) ? Math.min(t, Date.now()) : Date.now() }; })
      .sort((a, b) => b.t - a.t);
    const buang = katakunci(s.buang);
    const had = Date.now() - BARU_HARI * 864e5;
    // Kali pertama sumber dibaca: ambil 3 terbaru walaupun dah lama, supaya sumber yang jarang update (contoh Mufti WP) tak kosong
    const pertama = !s.semak_at;
    const insert = db.prepare(`INSERT OR IGNORE INTO feed_item (sumber_id, guid, url, tajuk_asal, petikan, terbit_at, dibuat_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let baru = 0;
    for (const [n, i] of items.slice(0, 40).entries()) {
      const tajuk = bersih(i.tajuk, 300);
      const petikan = bersih(i.petikan);
      if (!tajuk || !/^https?:\/\//.test(i.url)) continue;
      const masa = i.t;
      if (masa < had && !(pertama && n < 3)) continue;
      const hay = `${tajuk} ${petikan}`.toLowerCase();
      if (buang.some((k) => hay.includes(k))) continue;
      baru += insert.run(s.id, (i.guid || i.url).slice(0, 500), i.url, tajuk, petikan, new Date(masa).toISOString(), now()).changes;
    }
    db.prepare('UPDATE feed_sumber SET ralat = NULL, semak_at = ? WHERE id = ?').run(now(), s.id);
    return baru;
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'Tiada jawapan dalam 60 saat' : e.cause?.code === 'ENOTFOUND' || e.cause?.code === 'EAI_AGAIN' ? 'Alamat tak dijumpai' : e.message;
    db.prepare('UPDATE feed_sumber SET ralat = ?, semak_at = ? WHERE id = ?').run(msg.slice(0, 200), now(), s.id);
    return 0;
  }
}

// ---------- Terjemah dan ringkas dengan Claude ----------

const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 2, timeout: 120_000 }) : null;

const ARAHAN = `Kau editor feed berita peribadi untuk seorang pencipta kandungan blog dan TikTok di Malaysia. Untuk setiap item yang diberi, pulangkan:

- tajuk: tajuk berita dalam Bahasa Melayu Malaysia (bukan Bahasa Indonesia) yang ringkas, jelas dan tepat. Guna huruf besar hanya pada perkataan pertama dan nama khas (bukan Huruf Besar Setiap Perkataan), termasuk bila tajuk asal ditulis dengan huruf besar semua. Kekalkan nama khas seperti nama orang, game, produk, Pokémon dan istilah teknologi yang lazim disebut dalam bahasa Inggeris (contoh: iPhone, update, event, raid). Kalau item asal dah dalam BM, kemaskan sahaja. Tiada clickbait, tiada emoji.
- ringkasan: satu ayat BM yang lengkap, sasarkan 8 hingga 12 patah perkataan (had mutlak ${MAX_PERKATAAN}), yang beri maklumat tambahan penting dan tidak sekadar ulang tajuk. Kalau tiada maklumat tambahan, terangkan kenapa berita itu penting.
- relevan: false kalau item itu bukan berita atau maklumat berguna (contoh: sembang, jawapan kepada komen, promosi, link referral, post nombor atau emoji sahaja), atau tidak menepati "tapisan" sumbernya. Untuk item tidak relevan, tajuk dan ringkasan boleh dibiar kosong.

Untuk item agama, kekalkan maksud asal dengan tepat dan jangan buat kesimpulan hukum sendiri. Untuk isu semasa, kekal neutral.
Jawab untuk setiap id yang diberi.`;

const SKEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['item'],
  properties: {
    item: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'relevan', 'tajuk', 'ringkasan'],
        properties: { id: { type: 'integer' }, relevan: { type: 'boolean' }, tajuk: { type: 'string' }, ringkasan: { type: 'string' } },
      },
    },
  },
};

const kiraPerkataan = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const potong = (s, n) => { const w = s.trim().split(/\s+/); return w.length <= n ? s.trim() : `${w.slice(0, n).join(' ').replace(/[,.;:]+$/, '')}…`; };

function mesejRalat(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API key Claude tak sah atau dah dibatalkan. Tukar ANTHROPIC_API_KEY dalam .env Studio.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'API key Claude tiada kebenaran untuk model ini.';
  if (e instanceof Anthropic.RateLimitError) return 'Claude API sibuk (had kadar). Akan cuba lagi pada pusingan seterusnya.';
  if (e instanceof Anthropic.BadRequestError && /credit|billing/i.test(e.message)) return 'Kredit Claude API habis. Top-up di console.anthropic.com, dan berita tertangguh akan diterjemah semula secara automatik.';
  if (e instanceof Anthropic.APIConnectionError) return 'Tak dapat sambung ke Claude API.';
  if (e instanceof Anthropic.APIError) return `Claude API: ralat ${e.status ?? ''} ${e.message}`.slice(0, 300);
  return `Terjemahan gagal: ${e.message}`.slice(0, 300);
}

async function terjemahKelompok(rows) {
  const input = rows.map((r) => ({
    id: r.id,
    kategori: r.kategori,
    sumber: r.sumber,
    ...(r.tapis ? { tapisan: r.tapis } : {}),
    tajuk: r.tajuk_asal,
    ...(r.petikan && r.petikan !== r.tajuk_asal ? { petikan: r.petikan.slice(0, 500) } : {}),
  }));
  const res = await claude.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: ARAHAN,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SKEMA } },
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude menolak kelompok ini');
  if (res.stop_reason === 'max_tokens') throw new Error('Jawapan Claude terpotong');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text).item;
}

async function terjemah() {
  if (!claude) { setTetapan('ai_ralat', 'ANTHROPIC_API_KEY belum diset dalam .env Studio.'); return; }
  const pilih = db.prepare(`
    SELECT i.id, i.tajuk_asal, i.petikan, i.cuba, s.nama sumber, s.tapis, k.nama kategori
    FROM feed_item i JOIN feed_sumber s ON s.id = i.sumber_id JOIN feed_kategori k ON k.id = s.kategori_id
    WHERE i.status = 'baru' AND i.cuba < 3 ORDER BY i.terbit_at DESC LIMIT ${KELOMPOK}`);
  const siap = db.prepare("UPDATE feed_item SET status = 'siap', tajuk = ?, ringkasan = ? WHERE id = ?");
  const buang = db.prepare("UPDATE feed_item SET status = 'buang' WHERE id = ?");
  const cuba = db.prepare('UPDATE feed_item SET cuba = cuba + 1 WHERE id = ?');
  for (let n = 0; n < 15; n++) { // paling banyak 300 item setiap pusingan
    const rows = pilih.all();
    if (!rows.length) break;
    let hasil;
    try {
      hasil = await terjemahKelompok(rows);
    } catch (e) {
      console.error('Feed:', e.message);
      setTetapan('ai_ralat', mesejRalat(e));
      if (e instanceof Anthropic.APIError) return; // masalah key/kredit/sambungan: berhenti, cuba pusingan seterusnya
      for (const r of rows) cuba.run(r.id);
      continue;
    }
    setTetapan('ai_ralat', '');
    const byId = new Map(rows.map((r) => [r.id, r]));
    const dijawab = new Set();
    for (const h of hasil || []) {
      const r = byId.get(h.id);
      if (!r || dijawab.has(h.id)) continue;
      dijawab.add(h.id);
      if (!h.relevan) { buang.run(h.id); continue; }
      const tajuk = h.tajuk.trim();
      let ringkasan = h.ringkasan.trim();
      if (!tajuk) { cuba.run(h.id); continue; }
      // Had 15 patah perkataan: cuba sekali lagi, kali kedua potong sahaja
      if (kiraPerkataan(ringkasan) > MAX_PERKATAAN) {
        if (r.cuba < 1) { cuba.run(h.id); continue; }
        ringkasan = potong(ringkasan, MAX_PERKATAAN);
      }
      siap.run(tajuk, ringkasan, h.id);
    }
    for (const r of rows) if (!dijawab.has(r.id)) cuba.run(r.id);
  }
}

// ---------- Pusingan ----------

let jalan = null;
export function pusingan() {
  if (jalan) return jalan;
  jalan = (async () => {
    const sumber = db.prepare('SELECT * FROM feed_sumber WHERE aktif = 1').all();
    // 4 sumber serentak
    const q = [...sumber];
    await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await tarikSumber(q.shift()); }));
    await terjemah();
    const lama = new Date(Date.now() - SIMPAN_HARI * 864e5).toISOString();
    db.prepare('DELETE FROM feed_item WHERE terbit_at < ? AND dibuat_at < ?').run(lama, lama);
    setTetapan('akhir_at', now());
  })().catch((e) => console.error('Feed:', e)).finally(() => { jalan = null; });
  return jalan;
}

export function mulaFeed() {
  setTimeout(pusingan, 15_000);
  setInterval(pusingan, SELANG_MIN * 60_000);
}

// ---------- API ----------

const KAT_RE = /^\d+$/;
function sahSumber(b, lama = {}) {
  const s = { ...lama, ...b };
  const out = {
    nama: String(s.nama || '').trim().slice(0, 80),
    jenis: String(s.jenis || ''),
    alamat: String(s.alamat || '').trim(),
    tapis: String(s.tapis || '').trim().slice(0, 300),
    buang: String(s.buang || '').trim().slice(0, 300),
    aktif: s.aktif === false || s.aktif === 0 ? 0 : 1,
    kategori_id: Number(s.kategori_id),
  };
  if (!JENIS.includes(out.jenis)) throw Object.assign(new Error('Jenis sumber tak dikenali'), { status: 400 });
  if (out.jenis === 'threads') {
    out.alamat = out.alamat.replace(/^https?:\/\/(www\.)?threads\.(net|com)\/@?/i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    if (!/^[A-Za-z0-9._]{1,40}$/.test(out.alamat)) throw Object.assign(new Error('Nama pengguna Threads tak sah'), { status: 400 });
  }
  if (out.jenis === 'rss' && !/^https?:\/\/\S+$/.test(out.alamat)) throw Object.assign(new Error('Alamat feed mesti bermula dengan https://'), { status: 400 });
  if (out.jenis === 'google' && (!out.alamat || out.alamat.length > 200)) throw Object.assign(new Error('Isi kata kunci carian (maksimum 200 aksara)'), { status: 400 });
  if (out.jenis === 'leekduck') out.alamat = '';
  if (!out.nama) out.nama = out.jenis === 'threads' ? `@${out.alamat}` : out.jenis === 'leekduck' ? 'Leek Duck' : out.alamat.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60);
  if (!db.prepare('SELECT 1 FROM feed_kategori WHERE id = ?').get(out.kategori_id)) throw Object.assign(new Error('Kategori tak wujud'), { status: 400 });
  return out;
}

export function feedRoutes() {
  const r = new Hono();

  r.get('/', (c) => {
    const kat = c.req.query('kategori');
    const kategori = db.prepare(`
      SELECT k.id, k.nama, COUNT(i.id) n FROM feed_kategori k
      LEFT JOIN feed_sumber s ON s.kategori_id = k.id
      LEFT JOIN feed_item i ON i.sumber_id = s.id AND i.status = 'siap'
      GROUP BY k.id ORDER BY k.susunan, k.id`).all();
    const where = KAT_RE.test(kat || '') ? 'AND s.kategori_id = ?' : '';
    const item = db.prepare(`
      SELECT i.id, i.url, i.tajuk, i.ringkasan, i.tajuk_asal, i.terbit_at, s.nama sumber, s.jenis, k.nama kategori
      FROM feed_item i JOIN feed_sumber s ON s.id = i.sumber_id JOIN feed_kategori k ON k.id = s.kategori_id
      WHERE i.status = 'siap' ${where} ORDER BY i.terbit_at DESC LIMIT 200`).all(...(where ? [Number(kat)] : []));
    const menunggu = db.prepare("SELECT COUNT(*) n FROM feed_item WHERE status = 'baru' AND cuba < 3").get().n;
    const ralat = db.prepare('SELECT nama, ralat FROM feed_sumber WHERE aktif = 1 AND ralat IS NOT NULL').all();
    return c.json({ kategori, item, menunggu, ai_ralat: tetapan('ai_ralat') || null, sumber_ralat: ralat, akhir_at: tetapan('akhir_at'), jalan: !!jalan });
  });

  r.post('/muat', (c) => { pusingan(); return c.json({ ok: true }); });

  r.get('/sumber', (c) => {
    const kategori = db.prepare('SELECT id, nama FROM feed_kategori ORDER BY susunan, id').all();
    const sumber = db.prepare('SELECT id, kategori_id, nama, jenis, alamat, tapis, buang, aktif, ralat, semak_at FROM feed_sumber ORDER BY id').all();
    return c.json(kategori.map((k) => ({ ...k, sumber: sumber.filter((s) => s.kategori_id === k.id).map((s) => ({ ...s, aktif: !!s.aktif })) })));
  });

  r.post('/kategori', async (c) => {
    const nama = String((await c.req.json()).nama || '').trim().slice(0, 40);
    if (!nama) return c.json({ ralat: 'Nama kategori kosong' }, 400);
    const susunan = db.prepare('SELECT COALESCE(MAX(susunan), -1) + 1 n FROM feed_kategori').get().n;
    const { lastInsertRowid } = db.prepare('INSERT INTO feed_kategori (nama, susunan) VALUES (?, ?)').run(nama, susunan);
    return c.json({ id: Number(lastInsertRowid), nama });
  });

  r.put('/kategori/:id', async (c) => {
    const nama = String((await c.req.json()).nama || '').trim().slice(0, 40);
    if (!nama) return c.json({ ralat: 'Nama kategori kosong' }, 400);
    db.prepare('UPDATE feed_kategori SET nama = ? WHERE id = ?').run(nama, Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  r.delete('/kategori/:id', (c) => {
    db.prepare('DELETE FROM feed_kategori WHERE id = ?').run(Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // Cuba baca sumber tanpa simpan: untuk semak sebelum tambah
  r.post('/sumber/uji', async (c) => {
    const s = sahSumber(await c.req.json());
    try {
      const items = await bacaSumber(s);
      return c.json({ n: items.length, contoh: items.slice(0, 3).map((i) => bersih(i.tajuk, 120)) });
    } catch (e) {
      return c.json({ ralat: `Tak dapat baca sumber: ${e.name === 'TimeoutError' ? 'tiada jawapan dalam 60 saat' : e.message}` }, 400);
    }
  });

  r.post('/sumber', async (c) => {
    const s = sahSumber(await c.req.json());
    const { lastInsertRowid } = db.prepare('INSERT INTO feed_sumber (kategori_id, nama, jenis, alamat, tapis, buang, aktif) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.kategori_id, s.nama, s.jenis, s.alamat, s.tapis, s.buang, s.aktif);
    const row = db.prepare('SELECT * FROM feed_sumber WHERE id = ?').get(lastInsertRowid);
    tarikSumber(row).then(() => terjemah()).catch(() => {});
    return c.json({ id: Number(lastInsertRowid) });
  });

  r.put('/sumber/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const lama = db.prepare('SELECT * FROM feed_sumber WHERE id = ?').get(id);
    if (!lama) return c.json({ ralat: 'Sumber tak wujud' }, 404);
    const s = sahSumber(await c.req.json(), lama);
    db.prepare('UPDATE feed_sumber SET kategori_id = ?, nama = ?, jenis = ?, alamat = ?, tapis = ?, buang = ?, aktif = ? WHERE id = ?')
      .run(s.kategori_id, s.nama, s.jenis, s.alamat, s.tapis, s.buang, s.aktif, id);
    return c.json({ ok: true });
  });

  r.delete('/sumber/:id', (c) => {
    db.prepare('DELETE FROM feed_sumber WHERE id = ?').run(Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  return r;
}
