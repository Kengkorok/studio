// Studio: senarai tulisan, editor dan moderasi komen
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import { Placeholder } from '@tiptap/extensions';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const tarikh = (iso) => { const [y, m, d] = iso.split('-'); return `${d} ${BULAN[Number(m) - 1]} ${y}`; };
const jam = (iso) => new Date(iso).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = { site: 'https://korokk.com', komen: false };

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

// Dialog ringkas: pengesahan atau satu input
function ask({ title, text = '', input, ok = 'OK', danger = false }) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-text').textContent = text;
  $('#dlg-text').hidden = !text;
  const inp = $('#dlg-input');
  inp.hidden = input === undefined;
  inp.value = input ?? '';
  inp.placeholder = input === undefined ? '' : 'https://';
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
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === (hash.startsWith('/komen') ? 'komen' : 'tulisan')));
  const m = hash.match(/^\/tulis\/([0-9a-f-]{36})$/);
  try {
    if (m) await editorView(m[1]);
    else if (hash.startsWith('/komen')) await komenView();
    else await listView();
  } catch (e) {
    view.innerHTML = `<section class="page"><p class="empty">${esc(e.message)}</p></section>`;
  }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- Senarai tulisan ----------

async function listView() {
  view.innerHTML = '<section class="page"><p class="empty mono">Memuat...</p></section>';
  const { live, drafts } = await api('/api/posts');
  const row = (p, kind) => `
    <li class="row">
      <button class="row__main" type="button" data-${kind === 'live' ? 'path' : 'id'}="${esc(kind === 'live' ? p.path : p.id)}">
        <span class="row__date mono">${esc(tarikh(p.date))}</span>
        <span class="row__title">${esc(p.title || 'Tanpa tajuk')}</span>
        <span class="row__meta mono">${kind === 'live'
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
  ['hr', '<svg viewBox="0 0 24 24"><path d="M4 12h16"/></svg>', 'Garis pemisah'], '|',
  ['html', '&lt;/&gt;', 'Tukar ke HTML'],
];

function prettyHtml(html) {
  return html
    .replace(/>\s*(<(?:p|h[1-6]|ul|ol|li|blockquote|pre|hr|figure|img|table|div)\b)/g, '>\n$1')
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
            <label class="field"><span class="mono">Tag</span><input class="input" id="tags" value="${esc(d.tags.join(', '))}" placeholder="homelab, masjid, kod"></label>
          </div>
          <div class="meta__group">
            <span class="mono field__label">Cover &amp; imej pratonton</span>
            <div class="cover" id="cover"></div>
            <div class="cover__actions">
              <button class="btn btn--sm" type="button" id="cover-up">Pilih gambar</button>
              <button class="btn btn--sm btn--ghost" type="button" id="cover-rm">Buang</button>
            </div>
            <label class="field"><span class="mono">Teks alt cover</span><input class="input" id="alt" value="${esc(d.image_alt)}" placeholder="Terangkan gambar"></label>
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
          <button type="button" class="tb tb--wide" data-cmd="alt">Teks alt</button>
          <button type="button" class="tb tb--wide" data-cmd="delimg">Buang</button>
        </span>
      </div>
      <input type="file" id="file" accept="image/*" hidden>
    </div>`;

  const status = $('#status');
  const titleEl = $('#title');
  const htmlEl = $('#html');
  const fileEl = $('#file');
  let htmlMode = false;
  let saveTimer = null;
  let saving = Promise.resolve();
  let pending = {};

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
      Placeholder.configure({ placeholder: 'Mula menulis... (tampal atau seret gambar terus ke sini)' }),
      BubbleMenu.configure({
        element: bubble,
        shouldShow: ({ editor: e, state }) => !htmlMode && (e.isActive('image') || !state.selection.empty),
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
    const img = editor.isActive('image');
    bubbleText.hidden = img;
    bubbleImg.hidden = !img;
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
    image: () => { fileEl.dataset.target = 'body'; fileEl.click(); },
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
  // Masukkan gambar di kursor; teks yang sedang dipilih tak diganti
  const insertImage = (src) => {
    const { selection } = editor.state;
    const chain = editor.chain().focus();
    if (!selection.node && !selection.empty) chain.setTextSelection(selection.to);
    chain.setImage({ src, alt: '' }).run();
  };
  function uploadFrom(files) {
    const imgs = [...(files || [])].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return false;
    (async () => {
      for (const f of imgs) {
        try { insertImage(await upload(f)); } catch (e) { toast(esc(e.message), 'err'); }
      }
    })();
    return true;
  }
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files[0];
    fileEl.value = '';
    if (!f) return;
    try {
      const url = await upload(f);
      if (fileEl.dataset.target === 'cover') { queue({ image: url }); d.image = url; d.og_auto = false; renderCover(); }
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
  $('#tags').addEventListener('change', (e) => queue({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }));
  $('#alt').addEventListener('input', (e) => queue({ image_alt: e.target.value }));
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
  $('#cover-up').addEventListener('click', () => { fileEl.dataset.target = 'cover'; fileEl.click(); });
  $('#cover-rm').addEventListener('click', () => { d.image = ''; queue({ image: '' }); renderCover(); });
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
    const empty = !d.path && !d.title.trim() && !editor.getText().trim() && !/<img/.test(editor.getHTML());
    if (empty) await api(`/api/drafts/${id}`, { method: 'DELETE' }).catch(() => {});
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

// ---------- Mula ----------

(async () => {
  try {
    me = await api('/api/me');
    $('#site-link').href = `${me.site}/blog/`;
    if (me.komen) api('/api/komen?status=menunggu').then((k) => setBadge(k.length)).catch(() => {});
  } catch {}
  route();
})();
