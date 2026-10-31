// Logik tag yang dikongsi oleh editor (client) dan endpoint agent (server)

export const TAG_MAX = 8;

export const tagSlug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// Bentuk "bunyi" supaya ejaan BM/Inggeris dan typo biasa jadi sama: technology, tecnologi -> teknologi
export const tagBunyi = (s) => tagSlug(s).replace(/-/g, '').replace(/tion/g, 'si').replace(/ph/g, 'f')
  .replace(/([bcdgkpstw])h/g, '$1').replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/y$/, 'i').replace(/(.)\1+/g, '$1');

function jarak(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export const tagMirip = (a, b) => {
  const x = tagBunyi(a), y = tagBunyi(b), len = Math.max(x.length, y.length);
  return x === y || jarak(x, y) <= (len >= 8 ? 2 : len >= 5 ? 1 : 0);
};

// Tukar senarai tag kepada tag sedia ada bila ejaannya hampir sama.
// known: [{ tag, n }] disusun ikut kekerapan, jadi tag paling banyak diguna menang.
export function satukanTag(tags, known) {
  const out = [];
  for (const raw of tags) {
    const t = tagSlug(raw);
    if (!t) continue;
    const sama = known.find((k) => k.tag === t) || known.find((k) => tagMirip(k.tag, t));
    const pilih = sama ? sama.tag : t;
    if (!out.includes(pilih)) out.push(pilih);
  }
  return out.slice(0, TAG_MAX);
}
