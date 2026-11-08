// Cover AI: jana gambar melalui Image API OpenRouter
export const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'meta/muse-image';
const STUDIO_URL = (process.env.STUDIO_URL || 'https://studio.korokk.com').replace(/\/$/, '');
const GAYA = process.env.OPENROUTER_IMAGE_STYLE
  || 'Editorial blog cover illustration, clean composition, main subject centered, warm muted palette, no text, no letters, no watermark, no logos.';

const ralat = (status, message) => Object.assign(new Error(message), { status });

export const imagegenOn = () => !!process.env.OPENROUTER_API_KEY;

export const promptDari = ({ title = '', description = '' }) => [title, description].map((s) => s.trim()).filter(Boolean).join('. ');

export async function janaGambar(prompt) {
  prompt = String(prompt || '').trim();
  if (!prompt) throw ralat(400, 'Prompt kosong. Isi tajuk atau tulis prompt sendiri.');
  if (!imagegenOn()) throw ralat(400, 'OPENROUTER_API_KEY belum diset dalam .env Studio.');

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
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: `${prompt}\n\n${GAYA}`, aspect_ratio: '16:9', resolution: '1K' }),
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
