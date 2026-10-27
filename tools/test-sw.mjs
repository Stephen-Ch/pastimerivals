// Plan 52: service worker check. node tools/test-sw.mjs  (loads app/public/sw.js with mocked worker globals)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const BAD = '/art/card-batter-1901-light-a-90775c068d.webp';
const store = new Map([['pr-art-v1', new Map([[`https://pastimerivals.com${BAD}?x=1`, 'old'], ['https://pastimerivals.com/art/ok.webp', 'ok']])], ['pr-shell-v2', new Map()]]);
const log = { fetch: [], put: [], deleted: [] };
const cacheOf = (name) => {
  if (!store.has(name)) store.set(name, new Map());
  const m = store.get(name);
  return {
    match: async (r) => m.get(typeof r === 'string' ? r : r.url),
    put: async (r) => { log.put.push(typeof r === 'string' ? r : r.url); },
    delete: async (u, o) => { let n = 0; for (const k of [...m.keys()]) { const p = new URL(k); if (p.pathname === u && (o?.ignoreSearch || !p.search)) { m.delete(k); n++; } } log.deleted.push(u); return n > 0; },
  };
};
const handlers = {};
const self = { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} } };
const ctx = { self, location: { origin: 'https://pastimerivals.com' }, URL, Response,
  caches: { keys: async () => [...store.keys()], delete: async (k) => store.delete(k), open: async (n) => cacheOf(n), match: async () => undefined },
  fetch: async (r) => { log.fetch.push(r.url ?? r); return new Response('x', { status: 200 }); } };
vm.runInNewContext(readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8'), ctx);
let done; handlers.activate({ waitUntil: (p) => { done = p; } }); await done;
assert.ok(!store.has('pr-shell-v2'), 'old shell cache dropped');
assert.equal(store.get('pr-art-v1').size, 1, 'bad card removed from the art cache, other art kept');
for (const q of ['', '?x=1']) {
  let res; const req = { method: 'GET', url: `https://pastimerivals.com${BAD}${q}`, headers: new Map() };
  handlers.fetch({ request: req, respondWith: (p) => { res = p; } });
  assert.equal((await res).status, 404, `404 for ${q || 'plain'} URL`);
}
assert.equal(log.fetch.length, 0, 'bad card never fetched'); assert.equal(log.put.length, 0, 'bad card never cached');
console.log('sw.js plan 52 checks ok');
