// Gambar: kecilkan ke WebP (lebar maks 1600px), buang metadata, dan jana imej OG.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const MAX_W = 1600;

// Font Bricolage/JetBrains Mono dalam folder fonts/ (fontconfig baca env ni pada render teks pertama)
process.env.FONTCONFIG_FILE ||= fileURLToPath(new URL('../fonts/fonts.conf', import.meta.url));

export async function toWebp(buf) {
  const img = sharp(buf, { failOn: 'error', limitInputPixels: 80e6 }).rotate(); // ikut orientasi EXIF, kemudian EXIF dibuang
  const meta = await img.metadata();
  const animated = (meta.pages || 1) > 1;
  return sharp(buf, { animated, limitInputPixels: 80e6 })
    .rotate()
    .resize({ width: MAX_W, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Pecah tajuk kepada baris ikut anggaran lebar huruf
function wrap(text, maxChars, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

/** Kad OG 1200x630 gaya portfolio: tajuk besar, tarikh dan domain. */
export async function ogCard({ title, date, tags = [] }) {
  const len = String(title).length;
  const size = len <= 28 ? 104 : len <= 48 ? 84 : len <= 80 ? 68 : 56;
  const lines = wrap(title, Math.floor(1040 / (size * 0.44)), 4);
  const lineH = Math.round(size * 1.0);
  const top = 630 - 120 - (lines.length - 1) * lineH;
  const tagText = tags.slice(0, 3).map((t) => `#${t}`).join('  ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F1EBE0"/>
  <rect x="0" y="0" width="1200" height="10" fill="#9E4A2F"/>
  <circle cx="1112" cy="84" r="9" fill="#3F6B57"/>
  <text x="72" y="96" font-family="JetBrains Mono" font-size="26" fill="#7A6A5C">korokk.com/blog</text>
  <text font-family="Bricolage Grotesque" font-weight="600" font-size="${size}" letter-spacing="${-(size * 0.045).toFixed(1)}" fill="#2B211A">
    ${lines.map((l, i) => `<tspan x="68" y="${top + i * lineH}">${esc(l)}</tspan>`).join('\n    ')}
  </text>
  <text x="72" y="572" font-family="JetBrains Mono" font-size="24" fill="#7A6A5C">${esc(date)}</text>
  <text x="1128" y="572" text-anchor="end" font-family="JetBrains Mono" font-size="24" fill="#9E4A2F">${esc(tagText)}</text>
</svg>`;
  return sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
}
