// Laman utama korokk.com: isi dalam _data/laman.yml (repo laman), disunting dalam tab "Laman".
// Draf disimpan dalam SQLite. Terbit commit YAML dan media baru ke assets/laman/ dalam satu commit.
// Pratonton render templat sebenar dari repo (index.html + _includes/laman/*) dengan liquidjs.
import { Hono } from 'hono';
import YAML from 'yaml';
import { Liquid } from 'liquidjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './db.js';
import { readFile as readRepoFile, commit } from './github.js';
import { slugify } from './post.js';

const FAIL = '_data/laman.yml';
const TEMPLAT = { index: 'index.html', 'laman/projek.html': '_includes/laman/projek.html', 'laman/kad.html': '_includes/laman/kad.html', 'laman/ikon.html': '_includes/laman/ikon.html' };
export const PILIHAN = {
  warna_lab: ['mint', 'lilac', 'sky', 'butter', 'rose'],
  warna_kad: ['green', 'cream', 'ink', 'sky'],
  media: ['video', 'gambar', 'phone'],
  visual: ['tiada', 'gambar', 'nombor', 'terminal', 'papan'],
  baris: ['cmd', 'dim', 'ok', 'run', 'selesai', 'teks'],
  ikon: ['github', 'threads', 'tiktok', 'kofi', 'instagram', 'youtube', 'facebook', 'x', 'linkedin', 'whatsapp', 'telegram', 'email', 'link'],
};
const HEADER = `# Isi laman utama (index.html). Disunting melalui tab "Laman" dalam Studio.
# Teks biasa sahaja; baris baru dalam teks berbilang baris jadi <br>. **tebal** dalam "peralatan" jadi huruf tebal.
`;

db.exec(`
  CREATE TABLE IF NOT EXISTS laman_draf (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    data       TEXT NOT NULL,          -- JSON, bentuk sama macam _data/laman.yml
    sha        TEXT,                   -- sha fail laman.yml masa draf dibuka (kesan suntingan luar Studio)
    dirty      INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);
const now = () => new Date().toISOString();
const baca = () => db.prepare('SELECT * FROM laman_draf WHERE id = 1').get();
const simpan = (data, fields) => {
  const row = { data: JSON.stringify(data), updated_at: now(), ...fields };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO laman_draf (id, ${keys.join(', ')}) VALUES (1, ${keys.map(() => '?').join(', ')})
    ON CONFLICT (id) DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}`).run(...keys.map((k) => row[k]));
  return baca();
};

// ---------- Pengesahan: hanya medan yang dikenali, jenis betul, link selamat ----------

const teks = (v, max = 400) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, max);
const baris = (v, max = 200) => teks(v, max).replace(/\s*\n\s*/g, ' ');
const pilih = (v, list, def) => (list.includes(v) ? v : def);
const px = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : undefined);
const senarai = (v, max, fn) => (Array.isArray(v) ? v : []).slice(0, max).map(fn);
// Link: http(s), mailto:, tel:, #anchor atau path dalam laman. Lain (contoh javascript:) dibuang
const link = (v) => {
  const s = baris(v, 500).trim();
  return /^(https?:\/\/\S+|mailto:\S+|tel:[\d+ -]+|#[\w-]*|\/[\w./?=&%#-]*|[a-z0-9][\w./?=&%#-]*)$/i.test(s) ? s : '';
};
// Media: upload Studio, aset dalam repo, atau gambar https
const src = (v) => {
  const s = baris(v, 500).trim();
  return /^(\/uploads\/[0-9a-f-]{36}\/[a-z0-9][a-z0-9._-]*|assets\/[\w./-]+|https:\/\/\S+)$/.test(s) ? s : '';
};
const gambar = (g = {}) => ({ src: src(g.src), ...(g.alt ? { alt: baris(g.alt, 300) } : {}), ...(px(g.w) ? { w: px(g.w), h: px(g.h) } : {}) });

export function bersih(d = {}) {
  const ids = new Set();
  const idUnik = (v, tajuk) => {
    let id = slugify(v) || slugify(tajuk) || 'seksyen';
    for (let n = 2; ids.has(id) || ['lab', 'tulisan', 'hubungi'].includes(id); n++) id = `${slugify(v) || slugify(tajuk) || 'seksyen'}-${n}`;
    ids.add(id);
    return id;
  };
  return {
    meta: {
      title: baris(d.meta?.title, 120), description: baris(d.meta?.description, 300),
      og_title: baris(d.meta?.og_title, 120), og_description: baris(d.meta?.og_description, 300),
    },
    nav: {
      tag: baris(d.nav?.tag, 80), meta: teks(d.nav?.meta, 120), blog: baris(d.nav?.blog, 30),
      cta: { teks: baris(d.nav?.cta?.teks, 40), link: link(d.nav?.cta?.link), arw: baris(d.nav?.cta?.arw, 2) },
    },
    status: { label: baris(d.status?.label, 60), teks: baris(d.status?.teks, 80) },
    hero: { tajuk_1: baris(d.hero?.tajuk_1, 60), tajuk_2: baris(d.hero?.tajuk_2, 60), lede: baris(d.hero?.lede, 300) },
    lab: {
      label: baris(d.lab?.label, 30), tajuk: baris(d.lab?.tajuk, 80),
      projek: senarai(d.lab?.projek, 30, (p = {}) => {
        const m = p.media || {};
        const jenis = pilih(m.jenis, PILIHAN.media, 'video');
        return {
          nama: baris(p.nama, 80), ringkasan: baris(p.ringkasan, 500), warna: pilih(p.warna, PILIHAN.warna_lab, 'mint'),
          link: link(p.link), badge: baris(p.badge, 60), segera: baris(p.segera, 60),
          media: jenis === 'video'
            ? { jenis, bar: baris(m.bar, 80), video: src(m.video), video_phone: src(m.video_phone), poster: src(m.poster), alt: baris(m.alt, 300), ...(px(m.w) ? { w: px(m.w), h: px(m.h) } : {}) }
            : { jenis, ...(jenis === 'gambar' ? { bar: baris(m.bar, 80), alt: baris(m.alt, 300) } : {}), gambar: senarai(m.gambar, jenis === 'phone' ? 3 : 1, gambar) },
          links: senarai(p.links, 4, (l = {}) => ({ teks: baris(l.teks, 30), url: link(l.url) })).filter((l) => l.teks && l.url),
        };
      }),
    },
    peralatan: baris(d.peralatan, 800),
    seksyen_kad: senarai(d.seksyen_kad, 8, (sk = {}) => ({
      id: idUnik(sk.id, sk.tajuk), tajuk: baris(sk.tajuk, 60), nota: teks(sk.nota, 160),
      kad: senarai(sk.kad, 20, (k = {}) => {
        const v = k.visual || {};
        const jenis = pilih(v.jenis, PILIHAN.visual, 'tiada');
        const visual = { jenis };
        if (jenis === 'gambar') visual.gambar = senarai(v.gambar, 2, gambar);
        if (jenis === 'nombor') Object.assign(visual, { nombor: baris(v.nombor, 8), unit: baris(v.unit, 20) });
        if (jenis === 'terminal') {
          visual.baris = senarai(v.baris, 14, (b = {}) => ({
            jenis: pilih(b.jenis, PILIHAN.baris, 'teks'), teks: baris(b.teks, 80), ...(b.nota ? { nota: baris(b.nota, 30) } : {}),
          }));
        }
        if (jenis === 'papan') {
          Object.assign(visual, { tajuk: baris(v.tajuk, 40), status: baris(v.status, 40) });
          visual.tile = senarai(v.tile, 12, (t = {}) => ({ nama: baris(t.nama, 30), label: baris(t.label, 30) }));
        }
        return {
          kicker: baris(k.kicker, 100), live: k.live === true, tajuk: baris(k.tajuk, 60), peranan: baris(k.peranan, 120),
          huraian: baris(k.huraian, 600), chips: senarai(k.chips, 6, (c) => baris(c, 30)).filter(Boolean),
          warna: pilih(k.warna, PILIHAN.warna_kad, 'cream'), visual,
        };
      }),
      milestone: senarai(sk.milestone, 6, (m = {}) => ({ tarikh: baris(m.tarikh, 30), tajuk: baris(m.tajuk, 60), huraian: baris(m.huraian, 120) })),
    })),
    tulisan: { tajuk: baris(d.tulisan?.tajuk, 60), butang: baris(d.tulisan?.butang, 30) },
    hubungi: {
      pre: baris(d.hubungi?.pre, 160),
      cta: { teks: teks(d.hubungi?.cta?.teks, 60), link: link(d.hubungi?.cta?.link), arw: baris(d.hubungi?.cta?.arw, 2) },
      sosial: senarai(d.hubungi?.sosial, 16, (s = {}) => ({
        ikon: pilih(s.ikon, PILIHAN.ikon, 'link'), label: baris(s.label, 30), nota: baris(s.nota, 40), url: link(s.url),
      })).filter((s) => s.label && s.url),
    },
    footer: senarai(d.footer, 4, (f) => baris(f, 80)).filter(Boolean),
  };
}

async function tarikDariRepo() {
  const { text, sha } = await readRepoFile(FAIL);
  return simpan(bersih(YAML.parse(text)), { sha, dirty: 0 });
}

// ---------- Pratonton ----------

let cacheTemplat = { t: 0, fail: null };
async function templat() {
  if (cacheTemplat.fail && Date.now() - cacheTemplat.t < 60_000) return cacheTemplat.fail;
  const pasang = await Promise.all(Object.entries(TEMPLAT).map(async ([k, p]) => [k, (await readRepoFile(p)).text]));
  cacheTemplat = { t: Date.now(), fail: Object.fromEntries(pasang) };
  return cacheTemplat.fail;
}

export function lamanRoutes({ uploadId, uploads, site }) {
  const r = new Hono();
  const UP_RE = new RegExp(`/uploads/${uploadId}/([a-z0-9][a-z0-9._-]*)`, 'g');

  r.get('/', async (c) => {
    const row = baca() || (await tarikDariRepo());
    return c.json({ data: JSON.parse(row.data), dirty: !!row.dirty, updated_at: row.updated_at, uploadId, pilihan: PILIHAN });
  });

  // Buang perubahan dalam Studio dan ambil semula versi dari GitHub
  r.post('/muat-semula', async (c) => {
    const row = await tarikDariRepo();
    return c.json({ data: JSON.parse(row.data), dirty: false, updated_at: row.updated_at });
  });

  r.put('/', async (c) => {
    const b = await c.req.json();
    const row = simpan(bersih(b.data), { dirty: 1 });
    return c.json({ updated_at: row.updated_at, data: JSON.parse(row.data) });
  });

  r.get('/pratonton', async (c) => {
    const row = baca() || (await tarikDariRepo());
    const fail = await templat();
    const engine = new Liquid({ jekyllInclude: true, templates: fail });
    engine.registerFilter('jsonify', (v) => JSON.stringify(v));
    const index = fail.index.replace(/^---\n[\s\S]*?\n---\n/, '');
    // site.posts kosong: seksyen "Tulisan terkini" diambil dari laman live (perlukan data post penuh Jekyll)
    let html = await engine.parseAndRender(index, { site: { data: { laman: JSON.parse(row.data) }, posts: [] } });
    const live = await fetch(`${site}/`).then((res) => (res.ok ? res.text() : '')).catch(() => '');
    const tulisan = /<!-- Tulisan terkini[\s\S]*?<\/section>/.exec(live)?.[0] || '';
    const host = c.req.header('host');
    html = html
      .replace('<!-- Hubungi -->', `${tulisan}\n    <!-- Hubungi -->`)
      .replace(/(["(])\/uploads\//g, `$1//${host}/uploads/`) // aset laman guna <base>, upload Studio guna hos Studio
      .replace('<head>', `<head>\n  <base href="${site}/">`)
      .replace('<body>', '<body>\n  <div style="position:sticky;top:0;z-index:99;padding:8px 16px;background:#1B1C1E;color:#E8E8E4;font:12px/1.4 \'JetBrains Mono\',monospace;text-align:center">PRATONTON LAMAN UTAMA · belum diterbit</div>');
    return c.html(html, 200, { 'Cache-Control': 'no-store' });
  });

  // Terbit: satu commit dengan laman.yml dan media baru. ?cuba=1 pulangkan apa yang akan di-commit tanpa commit.
  r.post('/terbit', async (c) => {
    const row = baca();
    if (!row) return c.json({ ralat: 'Tiada draf laman.' }, 400);
    const b = await c.req.json().catch(() => ({}));
    const semasa = await readRepoFile(FAIL);
    if (row.sha && semasa.sha !== row.sha && !b.paksa) {
      return c.json({ ralat: 'laman.yml dah diubah di GitHub sejak draf ni dibuka. Muat semula dulu, atau terbit juga untuk tulis ganti.', konflik: true }, 409);
    }
    const json = row.data;
    const nama = [...new Set([...json.matchAll(UP_RE)].map((m) => m[1]))];
    const files = await Promise.all(nama.map(async (n) => ({ path: `assets/laman/${n}`, content: await readFile(join(uploads, uploadId, n)) })));
    const data = JSON.parse(json.replace(UP_RE, 'assets/laman/$1'));
    const yaml = HEADER + YAML.stringify(data, { lineWidth: 0 });
    // Media dalam assets/laman/ yang tak dirujuk lagi dibuang (aset asal di assets/lab/ tak diusik)
    const ASET_RE = /assets\/laman\/([a-z0-9][a-z0-9._-]*)/g;
    const kini = new Set([...yaml.matchAll(ASET_RE)].map((m) => m[1]));
    const deletes = [...new Set([...semasa.text.matchAll(ASET_RE)].map((m) => m[1]))].filter((n) => !kini.has(n)).map((n) => `assets/laman/${n}`);
    if (c.req.query('cuba') === '1') return c.json({ yaml, files: files.map((f) => f.path), deletes });

    const sha = await commit({
      message: 'laman: kemas kini laman utama\n\nDiterbitkan dari Studio',
      files: [...files, { path: FAIL, content: yaml }],
      deletes,
    });
    const baru = await readRepoFile(FAIL);
    const saved = simpan(data, { sha: baru.sha, dirty: 0 });
    return c.json({ ok: true, commit: sha, url: `${site}/`, data: JSON.parse(saved.data), updated_at: saved.updated_at });
  });

  return r;
}
