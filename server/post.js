// Tukar antara draf Studio dan fail post Jekyll (_posts/TARIKH-slug.html).
import YAML from 'yaml';
import { marked } from 'marked';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80).replace(/-+$/g, '');
}

export function todayKL() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
}

// "_posts/2026-10-28-hello-world.md" -> { date, slug, ext }
export function parsePath(path) {
  const m = /^_posts\/(\d{4}-\d{2}-\d{2})-(.+)\.(md|markdown|html)$/.exec(path);
  return m && { date: m[1], slug: m[2], ext: m[3] };
}

// Fail post dari repo -> medan draf
export function fromFile(path, text) {
  const info = parsePath(path) || {};
  const m = FM_RE.exec(text);
  const fm = (m && YAML.parse(m[1])) || {};
  let body = m ? text.slice(m[0].length) : text;
  body = body.replace(/^\s*\{%-?\s*raw\s*-?%\}\s*/, '').replace(/\s*\{%-?\s*endraw\s*-?%\}\s*$/, '');
  if (info.ext !== 'html') body = marked.parse(body, { gfm: true });
  const tags = Array.isArray(fm.tags) ? fm.tags : String(fm.tags || '').split(/[\s,]+/).filter(Boolean);
  return {
    title: String(fm.title || ''),
    slug: info.slug || slugify(fm.title),
    date: info.date || todayKL(),
    description: String(fm.description || ''),
    tags: tags.map(String),
    image: fm.image ? String(fm.image) : '',
    image_alt: fm.image_alt ? String(fm.image_alt) : '',
    cover: fm.cover !== false,
    komen: fm.komen !== false,
    og_auto: fm.og_auto === true,
    body: body.trim(),
  };
}

// Medan draf -> kandungan fail .html untuk Jekyll
export function toFile(d) {
  const fm = { title: d.title };
  if (d.description) fm.description = d.description;
  if (d.tags?.length) fm.tags = d.tags;
  if (d.image) fm.image = d.image;
  if (d.image && d.image_alt) fm.image_alt = d.image_alt;
  if (d.image && d.cover === false) fm.cover = false;
  if (d.og_auto) fm.og_auto = true;
  if (d.komen === false) fm.komen = false;
  const yaml = YAML.stringify(fm, { lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  // {% raw %} supaya teks macam {{ ini }} dalam post tak diproses oleh Liquid
  return `---\n${yaml}\n---\n{% raw %}\n${d.body.trim()}\n{% endraw %}\n`;
}

export function postPath(d) {
  return `_posts/${d.date}-${d.slug}.html`;
}

export function postUrl(d) {
  return `/blog/${d.slug}/`;
}

// Kemaskan HTML editor supaya senang dibaca dalam mod </> dan dalam git diff
export function prettyHtml(html) {
  return String(html || '')
    .replace(/>\s*(<(?:p|h[1-6]|ul|ol|li|blockquote|pre|hr|figure|img|video|table|thead|tbody|tr|div)\b)/g, '>\n$1')
    .replace(/(<\/(?:ul|ol|blockquote|table|thead|tbody|figure|div)>)/g, '\n$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
