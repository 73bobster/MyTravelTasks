import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, checkEmail, passwordProblem, newToken, sha256Hex } from '../server/auth.js';
import { parseCookies, sessionCookie, clearCookie, checkOrigin, readJson, HttpError } from '../server/http.js';

test('password hashing round-trips and rejects wrong passwords', async () => {
  const h = await hashPassword('correct horse battery');
  assert.match(h, /^pbkdf2\$100000\$/);
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('wrong horse battery', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  assert.notEqual(h, await hashPassword('correct horse battery'), 'salted');
});

test('email and password checks', () => {
  assert.equal(checkEmail('  Rob@Example.COM '), 'rob@example.com');
  assert.equal(checkEmail('nope'), null);
  assert.equal(checkEmail('a@b'), null);
  assert.ok(passwordProblem('short'));
  assert.equal(passwordProblem('long enough password'), null);
});

test('tokens are unique, url-safe and hash to 64 hex chars', async () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(await sha256Hex(a), /^[0-9a-f]{64}$/);
});

test('cookies', () => {
  assert.deepEqual(parseCookies('a=1; mtt_session=abc%20d'), { a: '1', mtt_session: 'abc d' });
  const c = sessionCookie('tok', true, 100);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Secure/);
  assert.doesNotMatch(sessionCookie('tok', false, 100), /Secure/);
  assert.match(clearCookie(true), /Max-Age=0/);
});

test('origin check blocks cross-site writes but allows same-origin and reads', () => {
  const url = new URL('https://mytraveltasks.cobaltpinksoftware.com/api/trips');
  const req = (method, headers = {}) => new Request(url, { method, headers });
  assert.doesNotThrow(() => checkOrigin(req('GET'), url));
  assert.doesNotThrow(() => checkOrigin(req('POST', { origin: url.origin }), url));
  assert.doesNotThrow(() => checkOrigin(req('POST', { 'sec-fetch-site': 'same-origin' }), url));
  assert.throws(() => checkOrigin(req('POST', { origin: 'https://evil.example' }), url), HttpError);
  assert.throws(() => checkOrigin(req('POST'), url), HttpError);
});

test('readJson requires a JSON content type and a sane size', async () => {
  const url = 'https://x.test/api';
  await assert.rejects(readJson(new Request(url, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })), HttpError);
  assert.deepEqual(await readJson(new Request(url, { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } })), { a: 1 });
  await assert.rejects(readJson(new Request(url, { method: 'POST', body: '{bad', headers: { 'content-type': 'application/json' } })), HttpError);
  await assert.rejects(readJson(new Request(url, { method: 'POST', body: 'x'.repeat(50), headers: { 'content-type': 'application/json' } }), 10), HttpError);
});
