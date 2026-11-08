// Cover AI: jana gambar melalui Image API OpenRouter
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.js';

export const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'meta/muse-image';
const STUDIO_URL = (process.env.STUDIO_URL || 'https://studio.korokk.com').replace(/\/$/, '');
const GAYA = process.env.OPENROUTER_IMAGE_STYLE
  || 'Editorial blog cover illustration, clean composition, main subject centered, warm muted palette, no text, no letters, no watermark, no logos.';

// "Libatkan aku": gambar muka Safwan dalam data/rujukan (maks 4) dihantar sebagai rujukan.
// Tanpa arahan gaya yang tegas, model cenderung pulangkan foto realistik.
const RUJUKAN = join(DATA_DIR, 'rujukan');
const JENIS = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const AKU = 'Flat editorial illustration, NOT a photograph: hand-drawn digital illustration with simplified shapes, soft grain texture and limited warm palette. Depict the man from the reference photos and keep his face, hairstyle and facial hair recognisable.';

export function failRujukan() {
  try {
    return readdirSync(RUJUKAN).filter((f) => JENIS[f.split('.').pop().toLowerCase()]).sort().slice(0, 4);
  } catch { return []; }
}

const ralat = (status, message) => Object.assign(new Error(message), { status });

export const imagegenOn = () => !!process.env.OPENROUTER_API_KEY;

export const NISBAH = ['16:9', '1:1', '4:5', '9:16'];

export const promptDari = ({ title = '', description = '' }) => [title, description].map((s) => s.trim()).filter(Boolean).join('. ');

export async function janaGambar(prompt, { nisbah = '16:9', aku = false } = {}) {
  prompt = String(prompt || '').trim();
  if (!prompt) throw ralat(400, 'Prompt kosong. Isi tajuk atau tulis prompt sendiri.');
  if (!NISBAH.includes(nisbah)) throw ralat(400, 'Nisbah gambar tak sah.');
  if (!imagegenOn()) throw ralat(400, 'OPENROUTER_API_KEY belum diset dalam .env Studio.');
  const rujukan = aku ? failRujukan() : [];
  if (aku && !rujukan.length) throw ralat(400, 'Tiada gambar rujukan dalam data/rujukan.');
  const body = { model: IMAGE_MODEL, prompt: `${aku ? `${AKU} ` : ''}${prompt}\n\n${GAYA}`, aspect_ratio: nisbah, resolution: '1K' };
  if (aku) {
    body.input_references = rujukan.map((f) => ({
      type: 'image_url',
      image_url: { url: `data:${JENIS[f.split('.').pop().toLowerCase()]};base64,${readFileSync(join(RUJUKAN, f)).toString('base64')}` },
    }));
  }

  // Tunggu maksimum 120 saat
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  let r;
  try {
    r = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': STUDIO_URL,
        'X-Title': 'korokk Studio',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw ralat(502, e.name === 'AbortError' ? 'OpenRouter ambil masa lebih 2 minit. Cuba lagi.' : `Tak dapat hubungi OpenRouter: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const data = await r.json().catch(() => ({}));
  if (r.status === 401) throw ralat(502, 'API key OpenRouter salah');
  if (r.status === 402) throw ralat(502, 'Kredit OpenRouter tak cukup (perlu baki lebih $1)');
  if (!r.ok) throw ralat(502, data.error?.message || `OpenRouter ${r.status}`);

  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw ralat(502, 'OpenRouter tak pulangkan gambar.');
  return { buf: Buffer.from(b64, 'base64'), cost: data.usage?.cost ?? null, model: IMAGE_MODEL };
}
