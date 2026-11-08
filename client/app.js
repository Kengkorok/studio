// Studio: senarai tulisan, editor dan moderasi komen
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube from '@tiptap/extension-youtube';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import { Placeholder } from '@tiptap/extensions';
import { TAG_MAX, tagSlug, tagMirip } from '../shared/tags.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const tarikh = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${BULAN[Number(m) - 1]} ${y}`; };
const jam = (iso) => new Date(iso).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = { site: 'https://korokk.com', komen: false };
const YOUTUBE_RE = /^(https?:\/\/)?((www|m|music)\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//;
const nombor = (n) => (n ?? 0).toLocaleString('ms-MY');

// Video yang diupload: satu blok <video> (tanpa node ni TipTap buang tag video, termasuk dalam mod HTML)
const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: null }, poster: { default: null }, width: { default: null }, height: { default: null } }),
  parseHTML: () => [{ tag: 'video[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['video', mergeAttributes(HTMLAttributes, { controls: '', playsinline: '', preload: 'metadata' })],
});

// Video TikTok: simpan sebagai <div data-tiktok-video="ID"> dengan iframe player rasmi TikTok (tanpa skrip embed.js)
const TIKTOK_ID = /(?:data-video-id=["']|\/(?:video|v|embed(?:\/v2)?|player\/v1)\/)(\d{8,25})/;
const tiktokPlayer = (id) => `https://www.tiktok.com/player/v1/${id}?description=1&music_info=1&rel=0`;
const Tiktok = Node.create({
  name: 'tiktok',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ id: { default: null } }),
  parseHTML: () => [
    { tag: 'div[data-tiktok-video]', getAttrs: (el) => ({ id: el.getAttribute('data-tiktok-video') }) },
    // Kod embed yang disalin dari TikTok (blockquote.tiktok-embed); didahulukan sebelum blockquote biasa
    { tag: 'blockquote.tiktok-embed', priority: 100, getAttrs: (el) => {
      const id = el.getAttribute('data-video-id') || TIKTOK_ID.exec(el.getAttribute('cite') || '')?.[1];
      return id ? { id } : false;
    } },
  ],
  renderHTML: ({ node }) => ['div', { 'data-tiktok-video': node.attrs.id }, ['iframe', {
    src: tiktokPlayer(node.attrs.id), title: 'Video TikTok', loading: 'lazy',
    allow: 'encrypted-media; fullscreen; picture-in-picture', allowfullscreen: 'true',
  }]],
});

// ---------- Pembantu ----------

async function api(path, { method = 'GET', body, form } = {}) {
  const r = await fetch(path, {
    method,
    headers: { 'X-Studio': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.ralat || `Ralat ${r.status}`);
  return data;
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.innerHTML = msg;
  t.className = `toast ${kind ? `toast--${kind}` : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 4000);
}

// ---------- Tag: cadangan dari tag yang pernah diguna ----------

let knownTags = null;
function tagField(root, initial, onChange) {
  let tags = [...initial];
  let items = [];
  let active = 0;
  root.innerHTML = `<div class="tags__box"><span class="tags__chips"></span><input id="tag-input" class="tags__input" autocomplete="off" spellcheck="false" placeholder="Taip tag..." role="combobox" aria-controls="tag-menu" aria-expanded="false"></div>
    <div class="tags__menu" id="tag-menu" role="listbox" hidden></div><p class="hint tags__hint" hidden></p>`;
  const chips = root.querySelector('.tags__chips'), input = root.querySelector('input');
  const menu = root.querySelector('.tags__menu'), hint = root.querySelector('.tags__hint');
  // Ambil semula setiap kali editor dibuka supaya tag dari post yang baru terbit ikut sekali
  const load = api('/api/tags').then((t) => (knownTags = t)).catch(() => (knownTags = knownTags || []));
  load.then(() => { if (document.activeElement === input) render(); });

  const drawChips = () => {
    chips.innerHTML = tags.map((t, i) => `<span class="tag">#${esc(t)}<button type="button" data-i="${i}" aria-label="Buang tag ${esc(t)}">×</button></span>`).join('');
    input.hidden = tags.length >= TAG_MAX;
  };
  const commit = (t) => {
    hint.hidden = true;
    input.value = '';
    if (t && !tags.includes(t) && tags.length < TAG_MAX) { tags.push(t); drawChips(); onChange([...tags]); }
    if (document.activeElement === input) render(); else close();
  };
  const close = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };

  // Senarai: padanan tepat, ejaan hampir sama, bermula dengan, mengandungi; tambah baru di bawah
  function render() {
    const q = tagSlug(input.value);
    const pool = (knownTags || []).filter((k) => !tags.includes(k.tag));
    items = [];
    if (!q) {
      items = pool.slice(0, 8).map((k) => ({ ...k, kind: 'ada' }));
    } else {
      const rank = (k) => (k.tag === q ? 0 : tagMirip(k.tag, q) ? 1 : k.tag.startsWith(q) ? 2 : k.tag.includes(q) ? 3 : 9);
      items = pool.map((k) => ({ ...k, r: rank(k) })).filter((k) => k.r < 9)
        .sort((a, b) => a.r - b.r || b.n - a.n).slice(0, 6).map((k) => ({ ...k, kind: k.r === 1 ? 'mirip' : 'ada' }));
      if (!items.some((k) => k.tag === q) && !tags.includes(q)) items.push({ tag: q, kind: 'baru', mirip: items.some((k) => k.kind === 'mirip') });
    }
    // Pilihan lalai: tag sedia ada yang sama, hampir sama atau bermula dengan apa yang ditaip; kalau tiada, tag baru
    const best = items.findIndex((k) => k.kind !== 'baru' && (k.tag === q || k.kind === 'mirip' || (q.length >= 2 && k.tag.startsWith(q))));
    active = !q ? -1 : best >= 0 ? best : items.findIndex((k) => k.kind === 'baru');
    menu.innerHTML = items.map((k, i) => `<button type="button" class="tags__opt${i === active ? ' is-active' : ''}" role="option" data-i="${i}" aria-selected="${i === active}">
      <span class="tags__name">#${esc(k.tag)}</span><span class="mono muted">${k.kind === 'baru' ? (k.mirip ? '+ baru, ada mirip' : '+ tag baru') : `${k.kind === 'mirip' ? 'mirip · ' : ''}${k.n ? `${k.n} post` : 'draf'}`}</span></button>`).join('');
    menu.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!menu.hidden));
  }
  const pick = (i) => { if (items[i]) commit(items[i].tag); };
  const move = (step) => {
    if (!items.length) return;
    active = (active + step + items.length) % items.length;
    menu.querySelectorAll('.tags__opt').forEach((b, i) => { b.classList.toggle('is-active', i === active); b.setAttribute('aria-selected', String(i === active)); });
    menu.children[active]?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => { hint.hidden = true; render(); });
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && input.value.trim())) {
      if (!input.value.trim() && active < 0) return;
      e.preventDefault();
      pick(active >= 0 ? active : items.findIndex((k) => k.kind === 'baru'));
    } else if (e.key === 'Backspace' && !input.value && tags.length) {
      tags.pop(); drawChips(); onChange([...tags]); render();
    }
  });
  // Keluar dari kotak: tag yang ditaip ditambah terus kecuali ada ejaan hampir sama yang perlu dipilih
  input.addEventListener('blur', () => setTimeout(() => {
    if (root.contains(document.activeElement)) return;
    close();
    const q = tagSlug(input.value);
    if (!q) return;
    const sama = (knownTags || []).find((k) => k.tag !== q && tagMirip(k.tag, q));
    if (sama && !tags.includes(sama.tag)) {
      hint.textContent = `"${q}" belum ditambah. Maksud kau #${sama.tag}? Tekan Enter dalam kotak tag untuk pilih.`;
      hint.hidden = false;
    } else commit(q);
  }, 150));
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('click', (e) => { const b = e.target.closest('.tags__opt'); if (b) { pick(Number(b.dataset.i)); input.focus(); } });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    tags.splice(Number(b.dataset.i), 1); drawChips(); onChange([...tags]); input.focus();
  });
  root.querySelector('.tags__box').addEventListener('click', (e) => { if (e.target === e.currentTarget) input.focus(); });
  drawChips();
}

// Dialog ringkas: pengesahan atau satu input
function ask({ title, text = '', input, ok = 'OK', danger = false, placeholder = 'https://' }) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-text').textContent = text;
  $('#dlg-text').hidden = !text;
  const inp = $('#dlg-input');
  inp.hidden = input === undefined;
  inp.value = input ?? '';
  inp.placeholder = input === undefined ? '' : placeholder;
  const okBtn = $('#dlg-ok');
  okBtn.textContent = ok;
  okBtn.classList.toggle('btn--danger', danger);
  dlg.returnValue = '';
  dlg.showModal();
  if (input !== undefined) { inp.focus(); inp.select(); }
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') resolve(null);
      else resolve(input === undefined ? true : inp.value.trim());
    }, { once: true });
  });
}

// ---------- Tema ----------

$('#tema').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('studio-tema', root.dataset.theme); } catch {}
});

// ---------- Router ----------

let cleanup = null;
async function route() {
  if (cleanup) { await cleanup(); cleanup = null; }
  const hash = location.hash.slice(1) || '/';
  const nav = hash.startsWith('/komen') ? 'komen' : hash.startsWith('/statistik') ? 'statistik' : hash.startsWith('/feed') ? 'feed' : 'tulisan';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === nav));
  document.querySelector('.top__nav .is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const m = hash.match(/^\/tulis\/([0-9a-f-]{36})$/);
  try {
    if (m) await editorView(m[1]);
    else if (nav === 'komen') await komenView();
    else if (nav === 'statistik') await statistikView();
    else if (hash === '/feed/urus') await urusFeedView();
    else if (nav === 'feed') await feedView();
    else await listView();
  } catch (e) {
    view.innerHTML = `<section class="page"><p class="empty">${esc(e.message)}</p></section>`;
  }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- Senarai tulisan ----------

// Penulis selain Safwan (sama dengan _data/penulis.yml di repo blog)
const PENULIS = { claudrok: 'Claudrok', korokgpt: 'korokGPT' };

async function listView() {
  view.innerHTML = '<section class="page"><p class="empty mono">Memuat...</p></section>';
  const { live, drafts } = await api('/api/posts');
  const row = (p, kind) => `
    <li class="row">
      <button class="row__main" type="button" data-${kind === 'live' ? 'path' : 'id'}="${esc(kind === 'live' ? p.path : p.id)}">
        <span class="row__date mono">${esc(tarikh(p.date))}</span>
        <span class="row__title">${esc(p.title || 'Tanpa tajuk')}</span>
        <span class="row__meta mono">${PENULIS[p.author] ? `<span class="pill pill--ai">${PENULIS[p.author]}</span> ` : ''}${kind === 'live'
          ? (p.dirty ? '<span class="pill pill--gold">ada perubahan belum terbit</span>' : '<span class="pill pill--green">live</span>')
          : `<span class="pill">draf</span> disimpan ${esc(jam(p.updated_at))}`}</span>
      </button>
      ${kind === 'live' ? `<a class="row__ext mono" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Buka di laman">↗</a>` : ''}
    </li>`;
  view.innerHTML = `
    <section class="page">
      <div class="page__head">
        <h1 class="page__title">Tulisan</h1>
        <button class="btn btn--ink" id="baru" type="button">+ Tulisan baru</button>
      </div>
      <h2 class="label mono">Draf</h2>
      ${drafts.length ? `<ol class="rows">${drafts.map((d) => row(d, 'draft')).join('')}</ol>` : '<p class="empty">Tiada draf. Tekan "Tulisan baru" untuk mula.</p>'}
      <h2 class="label mono">Dah terbit</h2>
      ${live.length ? `<ol class="rows">${live.map((p) => row(p, 'live')).join('')}</ol>` : '<p class="empty">Belum ada post di laman.</p>'}
    </section>`;
  $('#baru').addEventListener('click', async () => {
    const d = await api('/api/drafts', { method: 'POST' });
    location.hash = `/tulis/${d.id}`;
  });
  view.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => { location.hash = `/tulis/${b.dataset.id}`; }));
  view.querySelectorAll('[data-path]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const d = await api('/api/posts/open', { method: 'POST', body: { path: b.dataset.path } });
      location.hash = `/tulis/${d.id}`;
    } catch (e) { toast(esc(e.message), 'err'); b.disabled = false; }
  }));
}

// ---------- Editor ----------

const TOOLS = [
  ['h2', 'H2', 'Subtajuk'], ['h3', 'H3', 'Subtajuk kecil'], '|',
  ['bold', '<b>B</b>', 'Tebal (Ctrl+B)'], ['italic', '<i>I</i>', 'Condong (Ctrl+I)'], ['underline', '<u>U</u>', 'Garis bawah (Ctrl+U)'], '|',
  ['link', '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>', 'Pautan (Ctrl+K)'], '|',
  ['bullet', '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/></svg>', 'Senarai'],
  ['ordered', '<svg viewBox="0 0 24 24"><path d="M10 6h10M10 12h10M10 18h10M4 5h1.5v3M3.5 14h2.5l-2.5 3h2.5"/></svg>', 'Senarai bernombor'],
  ['quote', '<svg viewBox="0 0 24 24"><path d="M6 17h4v-5H7a3 3 0 0 1 3-3V7a5 5 0 0 0-5 5zm8 0h4v-5h-3a3 3 0 0 1 3-3V7a5 5 0 0 0-5 5z"/></svg>', 'Petikan'], '|',
  ['image', '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>', 'Gambar'],
  ['video', '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10.5 5-3v9l-5-3z"/></svg>', 'Video (upload)'],
  ['youtube', '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9.2 5 2.8-5 2.8z"/></svg>', 'YouTube'],
  ['tiktok', '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.6 2.2 4.4 5 4.6"/></svg>', 'TikTok'],
  ['hr', '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>', 'Garis pemisah'], '|',
  ['html', '&lt;/&gt;', 'Tukar ke HTML'],
];

function prettyHtml(html) {
  return html
    .replace(/>\s*(<(?:p|h[1-6]|ul|ol|li|blockquote|pre|hr|figure|img|video|table|div)\b)/g, '>\n$1')
    .replace(/(<\/(?:ul|ol|blockquote|table|figure|div)>)/g, '\n$1')
    .replace(/\n{2,}/g, '\n').trim();
}

async function editorView(id) {
  let d = await api(`/api/drafts/${id}`);
  view.innerHTML = `
    <div class="ed">
      <div class="ed__bar">
        <a class="ed__back mono" href="#/">← Tulisan</a>
        <span class="ed__status mono" id="status">${d.path ? (d.dirty ? 'Ada perubahan belum terbit' : 'Sama dengan laman') : 'Draf'}</span>
        <div class="ed__actions">
          <button class="btn btn--ghost ed__meta-btn" type="button" id="meta-btn" aria-expanded="false">Tetapan</button>
          <a class="btn btn--ghost" id="preview" href="/preview/${id}" target="_blank" rel="noopener">Pratonton</a>
          <button class="btn btn--ink" type="button" id="publish">${d.path ? 'Kemas kini' : 'Terbit'}</button>
        </div>
      </div>
      <div class="toolbar" id="toolbar" role="toolbar" aria-label="Format">
        ${TOOLS.map((t) => (t === '|' ? '<span class="toolbar__sep"></span>' : `<button type="button" class="tb" data-cmd="${t[0]}" title="${t[2]}" aria-label="${t[2]}">${t[1]}</button>`)).join('')}
      </div>
      <div class="ed__body">
        <div class="ed__main">
          <textarea class="ed__title" id="title" rows="1" placeholder="Tajuk post">${esc(d.title)}</textarea>
          <div class="prose" id="editor"></div>
          <textarea class="ed__html mono" id="html" spellcheck="false" hidden></textarea>
        </div>
        <aside class="meta" id="meta">
          <div class="meta__group">
            <label class="field"><span class="mono">Slug (URL)</span>
              <span class="slug"><span class="mono muted">/blog/</span><input class="input" id="slug" value="${esc(d.slug)}" ${d.path ? 'title="Tukar slug akan tukar URL post"' : ''}></span></label>
            <label class="field"><span class="mono">Tarikh</span><input class="input" type="date" id="date" value="${esc(d.date)}"></label>
            <label class="field"><span class="mono">Ringkasan</span><textarea class="input" id="desc" rows="3" maxlength="200" placeholder="Satu ayat. Keluar bawah tajuk dan dalam pratonton WhatsApp.">${esc(d.description)}</textarea></label>
            <div class="field"><label class="mono" for="tag-input">Tag</label><div class="tags" id="tags"></div></div>
            <label class="field"><span class="mono">Penulis</span><select class="input" id="author">
              ${[['safwan', 'Safwan'], ...Object.entries(PENULIS)].map(([k, n]) => `<option value="${k}" ${d.author === k ? 'selected' : ''}>${n}${k === 'safwan' ? '' : ' (AI) · disemak Safwan'}</option>`).join('')}
            </select></label>
          </div>
          <div class="meta__group">
            <span class="mono field__label">Sumber</span>
            <ol class="sumber" id="sumber"></ol>
            <button class="btn btn--sm btn--ghost sumber__add" type="button" id="sumber-add">+ Tambah sumber</button>
            <p class="hint">Keluar sebagai kotak "Sumber" di hujung post, ikut turutan ni. Kosongkan kalau tiada.</p>
          </div>
          <div class="meta__group">
            <span class="mono field__label">Cover &amp; imej pratonton</span>
            <p class="hint">Saiz canvas: <b>1200 × 630 px</b> (nisbah 1.91 : 1), atau 2400 × 1260 untuk lebih tajam. Letak tajuk dan muka di tengah, jauhkan 40 px dari tepi atas dan bawah. Elakkan gambar tegak atau segi empat sama, nanti terpotong.</p>
            <div class="cover" id="cover"></div>
            <div class="cover__actions">
              <button class="btn btn--sm" type="button" id="cover-up">Pilih gambar</button>
              <button class="btn btn--sm" type="button" id="cover-ai" ${me.coverAi ? '' : 'hidden'}>Jana dengan AI</button>
              <button class="btn btn--sm btn--ghost" type="button" id="cover-rm">Buang</button>
            </div>
            <label class="field"><span class="mono">Teks alt cover</span><input class="input" id="alt" value="${esc(d.image_alt)}" placeholder="Terangkan gambar"></label>
            <label class="field"><span class="mono">Kredit gambar</span><input class="input" id="credit" value="${esc(d.image_credit)}" placeholder="Gambar: Niantic"></label>
            <label class="check"><input type="checkbox" id="show-cover" ${d.cover ? 'checked' : ''}> Papar cover atas post</label>
            <p class="hint">Tanpa cover, Studio jana kad bertajuk secara automatik untuk pratonton link.</p>
          </div>
          <div class="meta__group">
            <label class="check"><input type="checkbox" id="komen" ${d.komen ? 'checked' : ''}> Buka komen</label>
          </div>
          <div class="meta__group meta__danger">
            ${d.path ? '<button class="btn btn--sm btn--ghost" type="button" id="unpublish">Tarik balik dari laman</button>' : ''}
            <button class="btn btn--sm btn--ghost btn--danger-text" type="button" id="del">${d.path ? 'Buang draf dari Studio' : 'Padam draf'}</button>
          </div>
        </aside>
      </div>
      <div class="bubble" id="bubble">
        <span class="bubble__text">
          <button type="button" class="tb" data-cmd="bold" aria-label="Tebal"><b>B</b></button>
          <button type="button" class="tb" data-cmd="italic" aria-label="Condong"><i>I</i></button>
          <button type="button" class="tb" data-cmd="underline" aria-label="Garis bawah"><u>U</u></button>
          <button type="button" class="tb" data-cmd="link" aria-label="Pautan">🔗</button>
        </span>
        <span class="bubble__img">
          <button type="button" class="tb tb--wide" data-cmd="alt" id="bubble-alt">Teks alt</button>
          <button type="button" class="tb tb--wide" data-cmd="delimg">Buang</button>
        </span>
      </div>
      <input type="file" id="file" hidden>
    </div>`;

  const status = $('#status');
  const titleEl = $('#title');
  const htmlEl = $('#html');
  const fileEl = $('#file');
  let htmlMode = false;
  let saveTimer = null;
  let saving = Promise.resolve();
  let pending = {};
  let alive = true;

  // Autosave: kumpul perubahan dan hantar selepas 1 saat senyap
  const queue = (fields) => {
    Object.assign(pending, fields);
    status.textContent = 'Belum disimpan...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1000);
  };
  const flush = () => {
    clearTimeout(saveTimer);
    if (!Object.keys(pending).length) return saving;
    const body = pending;
    pending = {};
    status.textContent = 'Menyimpan...';
    saving = saving.then(() => api(`/api/drafts/${id}`, { method: 'PUT', body }))
      .then((nd) => {
        d = nd;
        status.textContent = `Disimpan ${jam(nd.updated_at)}`;
        if (document.activeElement !== $('#slug')) $('#slug').value = nd.slug;
      })
      .catch((e) => { status.textContent = 'Gagal simpan'; toast(esc(e.message), 'err'); Object.assign(pending, body, pending); });
    return saving;
  };

  // Menu terapung dikeluarkan dari DOM bila tersorok, jadi simpan rujukan sekarang
  const bubble = $('#bubble');
  const bubbleText = $('.bubble__text', bubble);
  const bubbleImg = $('.bubble__img', bubble);
  const bubbleAlt = $('#bubble-alt', bubble);
  const isMedia = (e) => ['image', 'video', 'youtube', 'tiktok'].some((n) => e.isActive(n));
  const cmdButtons = [...view.querySelectorAll('.ed [data-cmd]')];

  const editor = new Editor({
    element: $('#editor'),
    content: d.body,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', HTMLAttributes: { target: null, rel: null } },
      }),
      Image.configure({ HTMLAttributes: { loading: 'lazy' } }),
      Video,
      Youtube.configure({ nocookie: true, width: 640, height: 360 }),
      Tiktok,
      Placeholder.configure({ placeholder: 'Mula menulis... (tampal atau seret gambar/video terus ke sini)' }),
      BubbleMenu.configure({
        element: bubble,
        shouldShow: ({ editor: e, state }) => !htmlMode && (isMedia(e) || !state.selection.empty),
      }),
    ],
    editorProps: {
      handlePaste: (_v, event) => uploadFrom(event.clipboardData?.files),
      handleDrop: (_v, event) => uploadFrom(event.dataTransfer?.files),
    },
    onUpdate: () => queue({ body: editor.getHTML() }),
    onTransaction: () => syncTools(),
  });

  // ----- Toolbar -----
  const isOn = {
    h2: () => editor.isActive('heading', { level: 2 }), h3: () => editor.isActive('heading', { level: 3 }),
    bold: () => editor.isActive('bold'), italic: () => editor.isActive('italic'), underline: () => editor.isActive('underline'),
    link: () => editor.isActive('link'), bullet: () => editor.isActive('bulletList'), ordered: () => editor.isActive('orderedList'),
    quote: () => editor.isActive('blockquote'), html: () => htmlMode,
  };
  function syncTools() {
    cmdButtons.forEach((b) => {
      const f = isOn[b.dataset.cmd];
      b.classList.toggle('is-on', !!f?.());
      if (b.closest('#toolbar') && b.dataset.cmd !== 'html') b.disabled = htmlMode;
    });
    const media = isMedia(editor);
    bubbleText.hidden = media;
    bubbleImg.hidden = !media;
    bubbleAlt.hidden = !editor.isActive('image');
  }

  async function editLink() {
    const { from, to } = editor.state.selection;
    const prev = editor.getAttributes('link').href || '';
    const url = await ask({ title: prev ? 'Ubah pautan' : 'Tambah pautan', text: 'Kosongkan untuk buang pautan.', input: prev, ok: 'Simpan' });
    if (url !== null) {
      const chain = editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link');
      if (!url) chain.unsetLink().run();
      else chain.setLink({ href: /^(https?:|mailto:|\/|#)/.test(url) ? url : `https://${url}` }).run();
      // Letak kursor selepas pautan supaya taipan seterusnya tak menulis ganti teks terpilih
      editor.commands.setTextSelection(editor.state.selection.to);
    }
    setTimeout(() => editor.commands.focus(), 0);
  }

  const run = {
    h2: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    h3: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(),
    link: editLink,
    bullet: () => editor.chain().focus().toggleBulletList().run(),
    ordered: () => editor.chain().focus().toggleOrderedList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    hr: () => editor.chain().focus().setHorizontalRule().run(),
    image: () => pick('body', 'image/*'),
    video: () => pick('video', 'video/*'),
    youtube: async () => {
      const url = await ask({ title: 'Masukkan video YouTube', text: 'Tampal link video YouTube.', input: '', ok: 'Masukkan' });
      if (!url) return;
      if (!YOUTUBE_RE.test(url.trim())) { toast('Link YouTube tak sah.', 'err'); return; }
      insert({ type: 'youtube', attrs: { src: url.trim() } });
    },
    tiktok: async () => {
      const input = await ask({ title: 'Masukkan video TikTok', text: 'Tampal link video TikTok, atau kod embed dari butang Embed di TikTok.', input: '', ok: 'Masukkan' });
      if (!input?.trim()) return;
      try {
        const id = TIKTOK_ID.exec(input)?.[1]
          || (await api(`/api/tiktok?url=${encodeURIComponent(/https?:\/\/\S+/.exec(input)?.[0] || input.trim())}`)).id;
        insert({ type: 'tiktok', attrs: { id } });
      } catch (e) { toast(e.message, 'err'); }
    },
    html: toggleHtml,
    alt: async () => {
      const alt = await ask({ title: 'Teks alt gambar', text: 'Penerangan ringkas untuk pembaca skrin dan bila gambar gagal dimuat.', input: editor.getAttributes('image').alt || '', ok: 'Simpan' });
      if (alt !== null) editor.chain().focus().updateAttributes('image', { alt }).run();
    },
    delimg: () => editor.chain().focus().deleteSelection().run(),
  };
  cmdButtons.forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // kekalkan pilihan teks
    b.addEventListener('click', () => run[b.dataset.cmd]?.());
  });
  editor.view.dom.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); editLink(); }
  });

  // ----- Mod HTML -----
  function toggleHtml() {
    if (!htmlMode) {
      htmlEl.value = prettyHtml(editor.getHTML());
      htmlEl.style.height = `${Math.max($('#editor').offsetHeight, 320)}px`;
      $('#editor').hidden = true;
      htmlEl.hidden = false;
      htmlMode = true;
      htmlEl.focus();
    } else {
      editor.commands.setContent(htmlEl.value, { emitUpdate: true });
      htmlEl.hidden = true;
      $('#editor').hidden = false;
      htmlMode = false;
      editor.commands.focus();
    }
    syncTools();
  }
  htmlEl.addEventListener('input', () => queue({ body: htmlEl.value }));

  // ----- Gambar -----
  async function upload(file) {
    const form = new FormData();
    form.append('file', file);
    toast(`Memproses ${esc(file.name)}...`);
    const { url, size } = await api(`/api/drafts/${id}/images`, { method: 'POST', form });
    toast(`Gambar sedia (${Math.round(size / 1024)} KB WebP)`, 'ok');
    return url;
  }
  // Video: hantar 32MB setiap cebisan, kemudian tunggu server siap tukar ke MP4
  async function uploadVideo(file) {
    if (file.size > 1024 ** 3) throw new Error('Video melebihi 1GB.');
    const CHUNK = 32 * 1024 * 1024;
    const up = crypto.randomUUID();
    let off = 0;
    do {
      const end = Math.min(off + CHUNK, file.size);
      const last = end >= file.size ? `&end=1&name=${encodeURIComponent(file.name)}` : '';
      toast(`Upload ${esc(file.name)}... ${Math.round((end / file.size) * 100) || 0}%`);
      await api(`/api/drafts/${id}/video?up=${up}&offset=${off}${last}`, { method: 'POST', form: file.slice(off, end) });
      off = end;
    } while (off < file.size);
    const t0 = Date.now();
    for (;;) {
      toast(`Memproses video... ${Math.round((Date.now() - t0) / 1000)}s <span class="muted">(boleh terus menulis)</span>`);
      await new Promise((r) => setTimeout(r, 2000));
      const job = await api(`/api/drafts/${id}/video/${up}`);
      if (job.status === 'gagal') throw new Error(job.ralat);
      if (job.status === 'siap') {
        toast(`Video sedia (${(job.result.size / 1048576).toFixed(1)} MB MP4)`, 'ok');
        return job.result;
      }
    }
  }
  // Masukkan gambar/video di kursor; teks yang sedang dipilih tak diganti
  const insert = (content) => {
    if (!alive) return;
    const { selection } = editor.state;
    const chain = editor.chain().focus();
    if (!selection.node && !selection.empty) chain.setTextSelection(selection.to);
    chain.insertContent(content).run();
    // Blok baru kekal terpilih; tanpa ni, taipan seterusnya akan ganti video/gambar tadi
    const { selection: sel, doc } = editor.state;
    if (sel.node) {
      const chain2 = editor.chain();
      if (!doc.resolve(sel.to).nodeAfter?.isTextblock) chain2.insertContentAt(sel.to, { type: 'paragraph' });
      chain2.setTextSelection(sel.to + 1).run();
    }
  };
  const insertImage = (src) => insert({ type: 'image', attrs: { src, alt: '' } });
  const insertVideo = ({ url, poster, width, height }) => insert({ type: 'video', attrs: { src: url, poster, width, height } });
  function uploadFrom(files) {
    const list = [...(files || [])].filter((f) => /^(image|video)\//.test(f.type));
    if (!list.length) return false;
    (async () => {
      for (const f of list) {
        try {
          if (f.type.startsWith('video/')) insertVideo(await uploadVideo(f));
          else insertImage(await upload(f));
        } catch (e) { toast(esc(e.message), 'err'); }
      }
    })();
    return true;
  }
  function pick(target, accept) {
    fileEl.dataset.target = target;
    fileEl.accept = accept;
    fileEl.click();
  }
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0];
    const target = fileEl.dataset.target;
    fileEl.value = '';
    if (!f) return;
    try {
      if (target === 'video') { insertVideo(await uploadVideo(f)); return; }
      const url = await upload(f);
      if (target === 'cover') { queue({ image: url }); d.image = url; d.og_auto = false; renderCover(); }
      else insertImage(url);
    } catch (e) { toast(esc(e.message), 'err'); }
  });

  // ----- Tajuk dan tetapan -----
  const grow = () => { titleEl.style.height = 'auto'; titleEl.style.height = `${titleEl.scrollHeight}px`; };
  grow();
  titleEl.addEventListener('input', () => { grow(); queue({ title: titleEl.value.replace(/\n/g, ' ') }); });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.focus('start'); } });
  $('#slug').addEventListener('change', (e) => queue({ slug: e.target.value }));
  $('#date').addEventListener('change', (e) => queue({ date: e.target.value }));
  $('#desc').addEventListener('input', (e) => queue({ description: e.target.value.replace(/\n/g, ' ') }));
  tagField($('#tags'), d.tags, (tags) => queue({ tags }));
  $('#alt').addEventListener('input', (e) => queue({ image_alt: e.target.value }));
  $('#credit').addEventListener('input', (e) => queue({ image_credit: e.target.value }));
  $('#author').addEventListener('change', (e) => queue({ author: e.target.value }));
  // Sumber: satu baris (link + nama) setiap sumber, maksimum 10
  const sumberEl = $('#sumber');
  const sumberRow = (s = {}) => {
    const li = document.createElement('li');
    li.className = 'sumber__row';
    li.innerHTML = `<input class="input" type="url" data-k="url" placeholder="https://… link artikel asal" aria-label="Link sumber">
      <input class="input" data-k="title" placeholder="Nama sumber, contoh: Pokémon GO Live" aria-label="Nama sumber">
      <button class="icon-btn sumber__rm" type="button" aria-label="Buang sumber" title="Buang sumber">×</button>`;
    $('[data-k="url"]', li).value = s.url || '';
    $('[data-k="title"]', li).value = s.title || '';
    sumberEl.append(li);
    $('#sumber-add').hidden = sumberEl.children.length >= 10;
    return li;
  };
  const saveSumber = () => queue({
    sumber: [...sumberEl.children]
      .map((li) => ({ url: $('[data-k="url"]', li).value.trim(), title: $('[data-k="title"]', li).value.trim() }))
      .filter((s) => s.url),
  });
  (d.sumber.length ? d.sumber : [{}]).forEach(sumberRow);
  sumberEl.addEventListener('input', saveSumber);
  sumberEl.addEventListener('click', (e) => {
    const li = e.target.closest('.sumber__rm')?.closest('li');
    if (!li) return;
    if (sumberEl.children.length > 1) li.remove();
    else li.querySelectorAll('input').forEach((i) => { i.value = ''; });
    $('#sumber-add').hidden = false;
    saveSumber();
  });
  $('#sumber-add').addEventListener('click', () => $('input', sumberRow()).focus());
  $('#show-cover').addEventListener('change', (e) => queue({ cover: e.target.checked }));
  $('#komen').addEventListener('change', (e) => queue({ komen: e.target.checked }));

  function renderCover() {
    const box = $('#cover');
    const auto = !d.image || d.og_auto;
    box.innerHTML = auto
      ? `<img src="/api/drafts/${id}/og.png?t=${Date.now()}" alt=""><span class="cover__tag mono">auto</span>`
      : `<img src="${esc(d.image)}" alt="">`;
    $('#cover-rm').hidden = auto;
  }
  renderCover();
  $('#cover-up').addEventListener('click', () => pick('cover', 'image/*'));
  $('#cover-rm').addEventListener('click', () => { d.image = ''; queue({ image: '' }); renderCover(); });

  // Cover AI: prompt lalai dari tajuk dan ringkasan, boleh diubah sebelum jana
  $('#cover-ai').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    let timer;
    try {
      await flush();
      const { prompt: lalai, model } = await api(`/api/drafts/${id}/cover-ai`);
      const prompt = await ask({
        title: 'Jana cover dengan AI',
        text: `Model ${model}. Setiap kali jana akan tolak kredit OpenRouter.`,
        input: lalai,
        placeholder: 'Terangkan gambar yang dimahukan',
        ok: 'Jana',
      });
      if (prompt === null) return;
      btn.disabled = true;
      const t0 = Date.now();
      const tick = () => toast(`Menjana cover... ${Math.round((Date.now() - t0) / 1000)}s`);
      tick();
      timer = setInterval(tick, 1000);
      const res = await api(`/api/drafts/${id}/cover-ai`, { method: 'POST', body: { prompt } });
      clearInterval(timer);
      d.image = res.draft.image;
      d.og_auto = false;
      if (!$('#credit').value.trim()) $('#credit').value = res.draft.image_credit || '';
      renderCover();
      const kos = typeof res.cost === 'number' ? ` · kos $${res.cost.toFixed(3)}` : '';
      toast(`Cover siap${kos}. Tak puas hati? Tekan lagi.`, 'ok');
    } catch (err) {
      toast(esc(err.message), 'err');
    } finally {
      clearInterval(timer);
      btn.disabled = false;
    }
  });
  $('#meta').addEventListener('focusout', () => { if (!d.image || d.og_auto) flush().then(renderCover); });

  $('#meta-btn').addEventListener('click', (e) => {
    const open = $('#meta').classList.toggle('is-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // ----- Pratonton, terbit, padam -----
  $('#preview').addEventListener('click', async (e) => {
    e.preventDefault();
    const w = window.open('about:blank', '_blank');
    await flush();
    if (w) w.location = `/preview/${id}`;
  });

  $('#publish').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (htmlMode) toggleHtml();
    await flush();
    const url = `${me.site}/blog/${d.slug}/`;
    const ok = await ask({
      title: d.path ? 'Kemas kini post di laman?' : 'Terbit sekarang?',
      text: `${d.title || 'Tanpa tajuk'}\n${url}\nLive dalam lebih kurang 1 minit.`,
      ok: d.path ? 'Kemas kini' : 'Terbit',
    });
    if (!ok) return;
    btn.disabled = true;
    btn.textContent = 'Menerbit...';
    try {
      const res = await api(`/api/drafts/${id}/publish`, { method: 'POST' });
      d = res.draft;
      editor.commands.setContent(d.body, { emitUpdate: false });
      pending = {};
      status.textContent = 'Sama dengan laman';
      btn.textContent = 'Kemas kini';
      renderCover();
      toast(`Diterbit! <a href="${esc(res.url)}" target="_blank" rel="noopener">Buka post ↗</a> <span class="muted">(tunggu ~1 minit)</span>`, 'ok');
    } catch (err) {
      toast(esc(err.message), 'err');
      btn.textContent = d.path ? 'Kemas kini' : 'Terbit';
    } finally {
      btn.disabled = false;
    }
  });

  $('#unpublish')?.addEventListener('click', async () => {
    const ok = await ask({ title: 'Tarik balik post?', text: 'Post akan hilang dari laman. Draf kekal dalam Studio dan boleh diterbit semula.', ok: 'Tarik balik', danger: true });
    if (!ok) return;
    try { await api(`/api/drafts/${id}/unpublish`, { method: 'POST' }); toast('Post ditarik balik.', 'ok'); route(); } catch (e) { toast(esc(e.message), 'err'); }
  });

  $('#del').addEventListener('click', async () => {
    const ok = await ask({
      title: d.path ? 'Buang draf dari Studio?' : 'Padam draf?',
      text: d.path ? 'Post di laman tak terjejas. Perubahan yang belum terbit akan hilang.' : 'Draf dan gambar yang belum diterbit akan dipadam.',
      ok: 'Padam', danger: true,
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    pending = {};
    await api(`/api/drafts/${id}`, { method: 'DELETE' });
    location.hash = '/';
  });

  // ----- Toolbar atas papan kekunci (phone) -----
  const tb = $('#toolbar');
  const vv = window.visualViewport;
  const place = () => {
    if (!vv || innerWidth > 720) { tb.style.transform = ''; return; }
    const offset = innerHeight - vv.height - vv.offsetTop;
    tb.style.transform = `translateY(${-Math.max(0, offset)}px)`;
  };
  vv?.addEventListener('resize', place);
  vv?.addEventListener('scroll', place);

  const beforeUnload = (e) => { if (Object.keys(pending).length) { flush(); e.preventDefault(); } };
  addEventListener('beforeunload', beforeUnload);

  syncTools();
  if (!d.title) titleEl.focus();

  cleanup = async () => {
    await flush();
    // Draf baru yang ditinggalkan kosong tak perlu disimpan
    const empty = !d.path && !d.title.trim() && !editor.getText().trim() && !/<(img|video|iframe)\b/.test(editor.getHTML());
    if (empty) await api(`/api/drafts/${id}`, { method: 'DELETE' }).catch(() => {});
    alive = false;
    removeEventListener('beforeunload', beforeUnload);
    vv?.removeEventListener('resize', place);
    vv?.removeEventListener('scroll', place);
    editor.destroy();
  };
}

// ---------- Komen ----------

async function komenView(status = 'menunggu') {
  if (!me.komen) {
    view.innerHTML = '<section class="page"><h1 class="page__title">Komen</h1><p class="empty">KOMEN_API belum diset dalam .env Studio.</p></section>';
    return;
  }
  view.innerHTML = `
    <section class="page">
      <div class="page__head">
        <h1 class="page__title">Komen</h1>
        <div class="seg mono" role="tablist">
          <button type="button" role="tab" data-s="menunggu" aria-selected="${status === 'menunggu'}">Menunggu</button>
          <button type="button" role="tab" data-s="lulus" aria-selected="${status === 'lulus'}">Dah lulus</button>
        </div>
      </div>
      <p class="hint">Komen tanpa akaun sahaja. Komen GitHub (giscus) diurus di GitHub Discussions.</p>
      <div id="komen-list"><p class="empty mono">Memuat...</p></div>
    </section>`;
  view.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => komenView(b.dataset.s)));
  const items = await api(`/api/komen?status=${status}`);
  if (status === 'menunggu') setBadge(items.length);
  const list = $('#komen-list');
  if (!items.length) { list.innerHTML = `<p class="empty">${status === 'menunggu' ? 'Tiada komen menunggu. 🎉' : 'Belum ada komen yang diluluskan.'}</p>`; return; }
  list.innerHTML = `<ol class="komen">${items.map((k) => `
    <li class="komen__item" data-k="${k.id}">
      <p class="komen__meta mono"><a href="${esc(me.site + k.post)}" target="_blank" rel="noopener">${esc(k.post)}</a> · ${esc(new Date(k.dibuat).toLocaleString('ms-MY', { dateStyle: 'medium', timeStyle: 'short' }))}</p>
      <p class="komen__who">${esc(k.nama)}</p>
      <p class="komen__text">${esc(k.isi)}</p>
      <div class="komen__act">
        ${status === 'menunggu' ? '<button class="btn btn--sm btn--ink" data-act="lulus" type="button">Lulus</button>' : ''}
        <button class="btn btn--sm btn--ghost btn--danger-text" data-act="padam" type="button">Padam</button>
      </div>
    </li>`).join('')}</ol>`;
  list.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('[data-k]');
    const kid = li.dataset.k;
    if (b.dataset.act === 'padam' && !(await ask({ title: 'Padam komen ni?', ok: 'Padam', danger: true }))) return;
    try {
      if (b.dataset.act === 'lulus') await api(`/api/komen/${kid}/lulus`, { method: 'POST' });
      else await api(`/api/komen/${kid}`, { method: 'DELETE' });
      li.remove();
      if (status === 'menunggu') setBadge(list.querySelectorAll('[data-k]').length);
      toast(b.dataset.act === 'lulus' ? 'Komen diluluskan. Keluar di blog dalam ~1 minit.' : 'Komen dipadam.', 'ok');
    } catch (e) { toast(esc(e.message), 'err'); }
  }));
}

function setBadge(n) {
  const b = $('#komen-count');
  b.textContent = n;
  b.hidden = !n;
}

// ---------- Statistik ----------

async function statistikView() {
  view.innerHTML = '<section class="page"><h1 class="page__title">Statistik</h1><p class="empty mono">Memuat...</p></section>';
  const s = await api('/api/statistik');
  const tahun = new Date().toLocaleString('en', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric' });
  const tile = (label, value, sub = '') => `
    <div class="stat"><span class="stat__label mono">${label}</span><span class="stat__value">${value}</span>${sub ? `<span class="stat__sub mono">${sub}</span>` : ''}</div>`;
  const l = s.lawatan;
  const lawatan = l ? `
      <h2 class="label mono">Lawatan korokk.com</h2>
      <table class="stats">
        <thead><tr><th></th><th class="mono">Sepanjang masa</th><th class="mono">7 hari lepas</th><th class="mono">Tahun ${tahun}</th></tr></thead>
        <tbody>
          <tr><th class="mono">Page view</th><td>${nombor(l.semua.views)}</td><td>${nombor(l.minggu.views)}</td><td>${nombor(l.tahun.views)}</td></tr>
          <tr><th class="mono">Pelawat</th><td>${nombor(l.semua.pelawat)}</td><td>${nombor(l.minggu.pelawat)}</td><td>${nombor(l.tahun.pelawat)}</td></tr>
        </tbody>
      </table>
      <p class="hint">Lawatan dari browser yang pernah buka Studio tak dikira. Untuk peranti lain, buka <a href="${esc(me.site)}/?abai=1" target="_blank" rel="noopener">${esc(me.site.replace(/^https?:\/\//, ''))}/?abai=1</a> sekali.</p>`
    : `<h2 class="label mono">Lawatan korokk.com</h2><p class="empty">${esc(s.ralat || 'Tiada data.')}</p>`;
  const komen = s.komen
    ? tile('Komen nama sahaja', nombor(s.komen.lulus), s.komen.menunggu ? `+ ${nombor(s.komen.menunggu)} menunggu` : '')
    : tile('Komen nama sahaja', '–');
  view.innerHTML = `
    <section class="page">
      <h1 class="page__title">Statistik</h1>
      ${lawatan}
      <h2 class="label mono">Kandungan</h2>
      <div class="stat-grid">
        ${tile('Post terbit', nombor(s.post.terbit), s.post.draf ? `${nombor(s.post.draf)} draf` : '')}
        ${komen}
        ${tile('Komen GitHub', s.giscus === null ? '–' : nombor(s.giscus), s.giscus === null ? 'token perlu Discussions: Read' : '')}
      </div>
      ${s.popular?.length ? `
      <h2 class="label mono">Paling dibaca</h2>
      <table class="stats stats--list">
        <thead><tr><th class="mono">Post</th><th class="mono">Page view</th><th class="mono">Pelawat</th></tr></thead>
        <tbody>${s.popular.map((p) => `<tr><th><a href="${esc(me.site + p.path)}" target="_blank" rel="noopener">${esc(p.title)}</a></th><td>${nombor(p.views)}</td><td>${nombor(p.pelawat)}</td></tr>`).join('')}</tbody>
      </table>` : ''}
    </section>`;
}

// ---------- Feed idea kandungan ----------

const lalu = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'baru tadi';
  if (s < 3600) return `${Math.round(s / 60)} min lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} hari lalu`;
  return tarikh(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }));
};
const JENIS_SUMBER = {
  rss: { nama: 'RSS', alamat: 'Alamat feed RSS', contoh: 'https://contoh.com/feed' },
  threads: { nama: 'Threads', alamat: 'Nama pengguna Threads', contoh: '@claudeai atau link profil' },
  google: { nama: 'Google News', alamat: 'Kata kunci carian', contoh: '"Pokemon Legends Z-A"' },
  leekduck: { nama: 'Leek Duck', alamat: '', contoh: '' },
};
const simpanKat = (v) => { try { localStorage.setItem('studio-feed-kat', v); } catch {} };
const bacaKat = () => { try { return localStorage.getItem('studio-feed-kat') || ''; } catch { return ''; } };

let feedTimer;
async function feedView(kat = bacaKat()) {
  clearTimeout(feedTimer);
  if (!view.querySelector('.feed-page')) view.innerHTML = '<section class="page"><h1 class="page__title">Feed</h1><p class="empty mono">Memuat...</p></section>';
  let f = await api(`/api/feed${kat ? `?kategori=${encodeURIComponent(kat)}` : ''}`);
  if (kat && !f.kategori.some((k) => String(k.id) === kat)) { kat = ''; simpanKat(''); f = await api('/api/feed'); }
  const jumlah = f.kategori.reduce((n, k) => n + k.n, 0);
  const banner = [
    f.ai_ralat ? `<p class="banner banner--err">⚠ ${esc(f.ai_ralat)}</p>` : '',
    f.sumber_ralat.length ? `<p class="banner banner--warn">⚠ ${f.sumber_ralat.length} sumber gagal dibaca: ${f.sumber_ralat.map((s) => esc(s.nama)).join(', ')}. <a href="#/feed/urus">Lihat sebab</a></p>` : '',
  ].join('');
  const status = f.jalan ? 'Sedang dikemas kini...' : f.akhir_at ? `Dikemas kini ${lalu(f.akhir_at)}` : 'Belum dikemas kini';
  view.innerHTML = `
    <section class="page feed-page">
      <div class="page__head">
        <h1 class="page__title">Feed</h1>
        <div class="feed__tools">
          <span class="mono muted">${status}${f.menunggu ? ` · ${nombor(f.menunggu)} sedang diterjemah` : ''}</span>
          <button class="btn btn--sm btn--ghost" id="feed-muat" type="button" ${f.jalan ? 'disabled' : ''}>Muat semula</button>
          <a class="btn btn--sm btn--ghost" href="#/feed/urus">Urus sumber</a>
        </div>
      </div>
      ${banner}
      <div class="chips" role="tablist" aria-label="Kategori">
        <button type="button" role="tab" class="chip" data-kat="" aria-selected="${!kat}">Semua <span class="chip__n">${nombor(jumlah)}</span></button>
        ${f.kategori.map((k) => `<button type="button" role="tab" class="chip" data-kat="${k.id}" aria-selected="${String(k.id) === kat}">${esc(k.nama)} <span class="chip__n">${nombor(k.n)}</span></button>`).join('')}
      </div>
      ${f.item.length ? `<ol class="feed">${f.item.map((i) => `
        <li class="feed__item">
          <a class="feed__title" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.tajuk_asal)}">${esc(i.tajuk)}<span class="feed__ext" aria-hidden="true"> ↗</span></a>
          ${i.ringkasan ? `<p class="feed__sum">${esc(i.ringkasan)}</p>` : ''}
          <p class="feed__meta mono">${esc(i.sumber)}${kat ? '' : ` · ${esc(i.kategori)}`} · <time datetime="${esc(i.terbit_at)}">${lalu(i.terbit_at)}</time></p>
        </li>`).join('')}</ol>`
        : `<p class="empty">${f.jalan || f.menunggu ? 'Berita sedang ditarik dan diterjemah. Tunggu sekejap...' : 'Tiada berita lagi untuk kategori ini.'}</p>`}
    </section>`;
  view.querySelectorAll('[data-kat]').forEach((b) => b.addEventListener('click', () => { simpanKat(b.dataset.kat); feedView(b.dataset.kat); }));
  $('#feed-muat').addEventListener('click', async () => {
    await api('/api/feed/muat', { method: 'POST' }).catch((e) => toast(esc(e.message), 'err'));
    feedView(kat);
  });
  // Semasa pusingan berjalan atau masih ada yang belum diterjemah, muat semula sendiri
  if (f.jalan || f.menunggu) {
    feedTimer = setTimeout(() => { if (location.hash === '#/feed') feedView(kat).catch(() => {}); }, 8000);
    cleanup = () => clearTimeout(feedTimer);
  }
}

async function urusFeedView() {
  const data = await api('/api/feed/sumber');
  view.innerHTML = `
    <section class="page">
      <a class="back mono" href="#/feed">← Feed</a>
      <div class="page__head">
        <h1 class="page__title">Urus sumber</h1>
        <button class="btn btn--sm btn--ink" id="kat-baru" type="button">+ Kategori baru</button>
      </div>
      <p class="hint">Feed ditarik setiap 30 minit. Tajuk diterjemah ke BM dan diringkaskan oleh Claude Haiku. "Tapisan" memberitahu Claude berita jenis apa yang diambil dari sumber itu; "buang" terus menolak berita yang ada kata kunci tersebut.</p>
      ${data.map((k) => `
        <div class="src-kat" data-k="${k.id}">
          <div class="src-kat__head">
            <h2 class="src-kat__title">${esc(k.nama)}</h2>
            <div class="src-kat__act">
              <button class="btn btn--sm btn--ghost" data-act="tambah" type="button">+ Sumber</button>
              <button class="btn btn--sm btn--ghost" data-act="nama" type="button">Tukar nama</button>
              <button class="btn btn--sm btn--ghost btn--danger-text" data-act="padam-kat" type="button">Padam</button>
            </div>
          </div>
          <div class="src-form-slot"></div>
          ${k.sumber.length ? `<ul class="src">${k.sumber.map((s) => `
            <li class="src__item ${s.aktif ? '' : 'is-off'}" data-s="${s.id}">
              <div class="src__main">
                <p class="src__name">${esc(s.nama)} <span class="pill">${JENIS_SUMBER[s.jenis]?.nama || esc(s.jenis)}</span></p>
                ${s.alamat ? `<p class="src__addr mono">${esc(s.alamat)}</p>` : ''}
                ${s.tapis ? `<p class="src__note">Tapisan: ${esc(s.tapis)}</p>` : ''}
                ${s.buang ? `<p class="src__note">Buang: ${esc(s.buang)}</p>` : ''}
                <p class="src__state mono ${s.ralat ? 'is-err' : ''}">${s.ralat ? `⚠ ${esc(s.ralat)}` : s.semak_at ? `✓ dibaca ${lalu(s.semak_at)}` : 'belum dibaca'}</p>
              </div>
              <div class="src__act">
                <label class="switch mono"><input type="checkbox" data-act="aktif" ${s.aktif ? 'checked' : ''}> Aktif</label>
                <button class="btn btn--sm btn--ghost" data-act="sunting" type="button">Sunting</button>
                <button class="btn btn--sm btn--ghost btn--danger-text" data-act="padam" type="button">Padam</button>
              </div>
            </li>`).join('')}</ul>` : '<p class="empty">Belum ada sumber.</p>'}
        </div>`).join('')}
    </section>`;

  const semula = () => urusFeedView();
  $('#kat-baru').addEventListener('click', async () => {
    const nama = await ask({ title: 'Kategori baru', input: '', ok: 'Tambah' });
    if (!nama) return;
    try { await api('/api/feed/kategori', { method: 'POST', body: { nama } }); semula(); } catch (e) { toast(esc(e.message), 'err'); }
  });

  view.querySelectorAll('[data-k]').forEach((box) => {
    const kid = Number(box.dataset.k);
    const kat = data.find((k) => k.id === kid);
    box.querySelector('[data-act="tambah"]').addEventListener('click', () => sumberForm(box.querySelector('.src-form-slot'), data, { kategori_id: kid, jenis: 'rss' }, semula));
    box.querySelector('[data-act="nama"]').addEventListener('click', async () => {
      const nama = await ask({ title: 'Tukar nama kategori', input: kat.nama, ok: 'Simpan' });
      if (!nama) return;
      try { await api(`/api/feed/kategori/${kid}`, { method: 'PUT', body: { nama } }); semula(); } catch (e) { toast(esc(e.message), 'err'); }
    });
    box.querySelector('[data-act="padam-kat"]').addEventListener('click', async () => {
      if (!(await ask({ title: `Padam kategori ${kat.nama}?`, text: 'Semua sumber dan berita dalam kategori ini turut dipadam.', ok: 'Padam', danger: true }))) return;
      try { await api(`/api/feed/kategori/${kid}`, { method: 'DELETE' }); semula(); } catch (e) { toast(esc(e.message), 'err'); }
    });
    box.querySelectorAll('[data-s]').forEach((li) => {
      const s = kat.sumber.find((x) => x.id === Number(li.dataset.s));
      li.querySelector('[data-act="aktif"]').addEventListener('change', async (e) => {
        try { await api(`/api/feed/sumber/${s.id}`, { method: 'PUT', body: { aktif: e.target.checked } }); li.classList.toggle('is-off', !e.target.checked); } catch (err) { toast(esc(err.message), 'err'); e.target.checked = !e.target.checked; }
      });
      li.querySelector('[data-act="sunting"]').addEventListener('click', () => sumberForm(box.querySelector('.src-form-slot'), data, s, semula));
      li.querySelector('[data-act="padam"]').addEventListener('click', async () => {
        if (!(await ask({ title: `Padam ${s.nama}?`, text: 'Berita dari sumber ini turut dibuang dari feed.', ok: 'Padam', danger: true }))) return;
        try { await api(`/api/feed/sumber/${s.id}`, { method: 'DELETE' }); semula(); } catch (e) { toast(esc(e.message), 'err'); }
      });
    });
  });
}

function sumberForm(slot, data, s, selesai) {
  view.querySelectorAll('.src-form-slot').forEach((el) => { el.innerHTML = ''; });
  const edit = !!s.id;
  slot.innerHTML = `
    <form class="src-form">
      <p class="src-form__title">${edit ? `Sunting ${esc(s.nama)}` : 'Sumber baru'}</p>
      <div class="src-form__grid">
        <label class="field"><span class="mono">Jenis</span><select class="input" name="jenis">
          ${Object.entries(JENIS_SUMBER).map(([k, j]) => `<option value="${k}" ${s.jenis === k ? 'selected' : ''}>${j.nama}</option>`).join('')}
        </select></label>
        <label class="field"><span class="mono">Kategori</span><select class="input" name="kategori_id">
          ${data.map((k) => `<option value="${k.id}" ${k.id === s.kategori_id ? 'selected' : ''}>${esc(k.nama)}</option>`).join('')}
        </select></label>
        <label class="field src-form__wide" data-alamat><span class="mono"></span><input class="input" name="alamat" value="${esc(s.alamat || '')}" autocomplete="off"></label>
        <label class="field src-form__wide"><span class="mono">Nama (pilihan)</span><input class="input" name="nama" value="${esc(s.nama || '')}" placeholder="Diisi sendiri kalau kosong"></label>
        <label class="field src-form__wide"><span class="mono">Tapisan untuk Claude (pilihan)</span><textarea class="input" name="tapis" rows="2" maxlength="300" placeholder="Contoh: berita iPhone sahaja. Abaikan promosi.">${esc(s.tapis || '')}</textarea></label>
        <label class="field src-form__wide"><span class="mono">Buang kalau ada kata kunci (pilihan, pisah dengan koma)</span><input class="input" name="buang" value="${esc(s.buang || '')}" placeholder="TCG, Pokémon Unite"></label>
      </div>
      <p class="src-form__uji mono" hidden></p>
      <div class="src-form__act">
        <button class="btn btn--sm btn--ghost" type="button" data-act="batal">Batal</button>
        <button class="btn btn--sm btn--ghost" type="button" data-act="uji">Uji</button>
        <button class="btn btn--sm btn--ink" type="submit">${edit ? 'Simpan' : 'Tambah'}</button>
      </div>
    </form>`;
  const form = slot.querySelector('form');
  const uji = form.querySelector('.src-form__uji');
  const jenis = form.elements.jenis;
  const kemas = () => {
    const j = JENIS_SUMBER[jenis.value];
    const box = form.querySelector('[data-alamat]');
    box.hidden = !j.alamat;
    box.querySelector('span').textContent = j.alamat;
    form.elements.alamat.placeholder = j.contoh;
  };
  jenis.addEventListener('change', kemas);
  kemas();
  const nilai = () => ({
    jenis: jenis.value,
    kategori_id: Number(form.elements.kategori_id.value),
    alamat: form.elements.alamat.value.trim(),
    nama: form.elements.nama.value.trim(),
    tapis: form.elements.tapis.value.trim(),
    buang: form.elements.buang.value.trim(),
  });
  form.querySelector('[data-act="batal"]').addEventListener('click', () => { slot.innerHTML = ''; });
  form.querySelector('[data-act="uji"]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    uji.hidden = false;
    uji.className = 'src-form__uji mono';
    uji.textContent = 'Membaca sumber...';
    try {
      const r = await api('/api/feed/sumber/uji', { method: 'POST', body: nilai() });
      uji.classList.add('is-ok');
      uji.innerHTML = `✓ ${nombor(r.n)} item dijumpai.${r.contoh.length ? `<br>${r.contoh.map((t) => `· ${esc(t)}`).join('<br>')}` : ''}`;
    } catch (err) {
      uji.classList.add('is-err');
      uji.textContent = `⚠ ${err.message}`;
    }
    e.target.disabled = false;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      if (edit) await api(`/api/feed/sumber/${s.id}`, { method: 'PUT', body: nilai() });
      else await api('/api/feed/sumber', { method: 'POST', body: nilai() });
      toast(edit ? 'Sumber disimpan.' : 'Sumber ditambah. Berita akan masuk dalam seminit dua.', 'ok');
      selesai();
    } catch (err) {
      toast(esc(err.message), 'err');
      btn.disabled = false;
    }
  });
  slot.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (jenis.value === 'leekduck' ? jenis : form.elements.alamat).focus({ preventScroll: true });
}

// ---------- Mula ----------

// Browser yang buka Studio tak dikira dalam statistik laman (lihat main.js dalam repo laman)
if (/(^|\.)korokk\.com$/.test(location.hostname)) {
  document.cookie = 'korok_abai=1; domain=korokk.com; path=/; secure; samesite=lax; max-age=315360000';
}

(async () => {
  try {
    me = await api('/api/me');
    $('#site-link').href = `${me.site}/blog/`;
    if (me.komen) api('/api/komen?status=menunggu').then((k) => setBadge(k.length)).catch(() => {});
  } catch {}
  route();
})();
