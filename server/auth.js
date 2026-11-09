// Password hashing and session tokens using only Web Crypto (works on Cloudflare Workers and Node).
const enc = new TextEncoder();

// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
export const PBKDF2_ITERATIONS = 100000;

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false;
  const got = await derive(password, unb64(salt), Number(iterations));
  return safeEqual(got, unb64(hash));
}

let dummyHash;
// Spend the same time when the email is unknown, so login timing does not reveal who has an account.
export async function dummyVerify(password) {
  dummyHash ||= await hashPassword('not-a-real-password');
  await verifyPassword(password, dummyHash);
  return false;
}

export function newToken() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function checkEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}

export const PASSWORD_MIN = 10;
export const passwordProblem = (pw) =>
  typeof pw !== 'string' || pw.length < PASSWORD_MIN
    ? `Use at least ${PASSWORD_MIN} characters.`
    : pw.length > 200
      ? 'That password is too long.'
      : null;
