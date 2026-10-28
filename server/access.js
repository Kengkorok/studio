// Sahkan JWT Cloudflare Access (header Cf-Access-Jwt-Assertion).
// Walaupun tunnel dah dikunci oleh Access, server tetap semak supaya port local tak boleh dipintas.
const TEAM = (process.env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const AUD = process.env.ACCESS_AUD || '';
const ALLOWED = (process.env.ACCESS_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

let keys = new Map();
let keysAt = 0;

async function loadKeys() {
  if (Date.now() - keysAt < 60 * 60 * 1000 && keys.size) return;
  const r = await fetch(`https://${TEAM}/cdn-cgi/access/certs`);
  const { keys: jwks } = await r.json();
  const next = new Map();
  for (const jwk of jwks) {
    next.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  keys = next;
  keysAt = Date.now();
}

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function verify(token) {
  const [h, p, sig] = token.split('.');
  if (!sig) return null;
  const header = JSON.parse(b64url(h).toString());
  const payload = JSON.parse(b64url(p).toString());
  await loadKeys();
  let key = keys.get(header.kid);
  if (!key) { keysAt = 0; await loadKeys(); key = keys.get(header.kid); }
  if (!key) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), Buffer.from(`${h}.${p}`));
  if (!ok) return null;
  const now = Date.now() / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.exp < now || (payload.nbf && payload.nbf > now + 60)) return null;
  if (!aud.includes(AUD)) return null;
  if (payload.iss !== `https://${TEAM}`) return null;
  if (ALLOWED.length && !ALLOWED.includes(String(payload.email || '').toLowerCase())) return null;
  return payload;
}

export const authMode = TEAM && AUD ? 'access' : process.env.ALLOW_NO_AUTH === '1' ? 'none' : 'locked';

/** Middleware Hono */
export async function requireAccess(c, next) {
  if (authMode === 'none') { c.set('email', 'dev@local'); return next(); }
  if (authMode === 'locked') return c.text('Studio dikunci: isi ACCESS_TEAM_DOMAIN dan ACCESS_AUD dalam .env', 503);
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  const user = token && (await verify(token).catch(() => null));
  if (!user) return c.text('Tak dibenarkan. Buka Studio melalui https://studio.korokk.com', 403);
  c.set('email', user.email);
  return next();
}
