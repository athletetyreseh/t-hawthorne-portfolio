import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import desk from '../functions/_shared/badge-desk.generated.js';
import { onRequest } from '../functions/badges/[[path]].js';
import { deleteExpiredPhotos } from '../badge-desk/src/retention-worker.js';

const origin = 'https://t-hawthorne.com';
function database() {
  const db = new DatabaseSync(':memory:');
  for (const name of ['0000_checkouts.sql', '0001_checkout_owner.sql', '0002_badge_rate_limits.sql']) {
    db.exec(readFileSync(new URL('../badge-desk/drizzle/' + name, import.meta.url), 'utf8'));
  }
  return db;
}
function adapter(db) {
  const prepare = (sql, values = []) => ({
    bind: (...next) => prepare(sql, next),
    all: async () => ({results: db.prepare(sql).all(...values)}),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => ({meta: db.prepare(sql).run(...values)})
  });
  return {prepare};
}
function fixture() {
  const db = database();
  const scheduler = new DatabaseSync(':memory:');
  scheduler.exec('CREATE TABLE private_permissions (user_email TEXT, resource_key TEXT, access_level TEXT)');
  const files = new Map();
  const env = {
    DB: adapter(db), SCHEDULER_DB: adapter(scheduler),
    BUCKET: {
      put: async (key, bytes) => files.set(key, bytes),
      get: async key => files.has(key) ? {body: files.get(key)} : null,
      delete: async key => files.delete(key)
    },
    OWNER_EMAIL: 'owner@example.com', CF_ACCESS_TEAM_DOMAIN: 'desk.cloudflareaccess.com',
    CF_ACCESS_AUD: 'desk-audience', SCHEDULER_DEV_BYPASS: 'true'
  };
  return {db, scheduler, files, env};
}
function req(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.ip !== false) headers.set('CF-Connecting-IP', opts.ip || '192.0.2.1');
  if (opts.method === 'POST' && opts.origin !== false) headers.set('Origin', opts.origin || origin);
  return new Request(origin + path, {method: opts.method || 'GET', headers, ...(opts.body ? {body: opts.body} : {})});
}
function checkoutForm({collateral = true, photo = false} = {}) {
  const form = new FormData();
  form.set('first_name', 'Test'); form.set('last_name', 'Visitor'); form.set('phone', '602-555-0100');
  if (collateral) form.set('id_collateral', 'yes');
  if (photo) form.set('photo', new File([new Uint8Array([255,216,255,1,255,217])], 'id.jpg', {type:'image/jpeg'}));
  return form;
}
async function call(path, env, opts = {}, authorized = false) {
  return desk.fetch(req(path, opts), env, authorized);
}

test('13 badge routes expose only status and public checkout/return need no sign-in', async () => {
  const {db, env} = fixture();
  const catalog = await (await call('/badges/catalog.json', env)).json();
  assert.equal(catalog.origin, origin + '/badges');
  assert.equal(catalog.badges.length, 13);
  for (const badge of catalog.badges) {
    assert.equal((await call('/badges/b/' + badge.slug, env)).status, 200);
    assert.equal((await call('/badges/qr/' + badge.slug + '.svg', env)).status, 200);
  }
  let response = await call('/badges/api/badge/wab-01', env, {method:'POST', body:checkoutForm()});
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {badge:'WAB-01'});
  response = await call('/badges/api/badge/wab-01', env);
  assert.deepEqual(await response.json(), {occupied:true});
  response = await call('/badges/api/badge/wab-01/return', env, {method:'POST'});
  assert.deepEqual(await response.json(), {returned:true});
  assert.equal((await (await call('/badges/api/badge/wab-01', env)).json()), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkouts').get().n, 1);
});

test('validation, origin, duplicate writes, bounded bodies and rate limit fail safely', async () => {
  const {db, env} = fixture();
  assert.equal((await call('/badges/api/badge/wab-01', env, {method:'POST', body:checkoutForm({collateral:false})})).status, 400);
  assert.equal((await call('/badges/api/badge/wab-01', env, {method:'POST', origin:'https://evil.example', body:checkoutForm()})).status, 403);
  assert.equal((await call('/badges/api/badge/wab-01', env, {method:'POST', origin:false, body:checkoutForm()})).status, 403);
  assert.equal((await call('/badges/api/badge/wab-01', env, {method:'POST', ip:false, body:checkoutForm()})).status, 503);
  const concurrent = await Promise.all(Array.from({length:8}, () => call('/badges/api/badge/wab-01', env, {method:'POST', body:checkoutForm()})));
  assert.equal(concurrent.filter(r => r.status === 201).length, 1);
  assert.equal(concurrent.filter(r => r.status === 409).length, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE returned_at IS NULL').get().n, 1);
  assert.equal((await call('/badges/api/badge/wab-01/return', env, {method:'POST', body:'x'.repeat(1025)})).status, 413);
  const invalid = checkoutForm();
  invalid.set('photo', new File(['not jpeg'], 'id.jpg', {type:'image/jpeg'}));
  assert.equal((await call('/badges/api/badge/wab-02', env, {method:'POST', body:invalid})).status, 400);
  for (let i=0; i<40; i++) await call('/badges/api/badge/amz-01/return', env, {method:'POST', ip:'192.0.2.2'});
  assert.equal((await call('/badges/api/badge/amz-01/return', env, {method:'POST', ip:'192.0.2.2'})).status, 429);
});

test('failed and uncertain photo inserts do not delete a committed photo', async () => {
  const {db, env, files} = fixture();
  const original = env.DB.prepare;
  env.DB.prepare = sql => {
    const stmt = original(sql);
    if (!sql.startsWith('INSERT INTO checkouts ')) return stmt;
    return {...stmt, bind: (...values) => ({run: async () => {
      await original(sql).bind(...values).run();
      throw new Error('response lost after commit');
    }})};
  };
  assert.equal((await call('/badges/api/badge/ship-01', env, {method:'POST', body:checkoutForm({photo:true})})).status, 201);
  const row = db.prepare('SELECT photo_key FROM checkouts').get();
  assert.ok(files.has(row.photo_key));
  env.DB.prepare = original;
  assert.equal((await call('/badges/api/badge/ship-01', env, {method:'POST', body:checkoutForm({photo:true})})).status, 409);
  assert.equal(files.size, 1, 'rejected duplicate upload is removed');

  const other = fixture();
  const prepare = other.env.DB.prepare;
  other.env.DB.prepare = sql => {
    const stmt = prepare(sql);
    if (!sql.startsWith('INSERT INTO checkouts ')) return stmt;
    return {...stmt, bind: () => ({run: async () => { throw new Error('uncertain insert'); }})};
  };
  assert.equal((await call('/badges/api/badge/amz-01', other.env, {method:'POST', body:checkoutForm({photo:true})})).status, 503);
  assert.equal(other.db.prepare('SELECT COUNT(*) AS n FROM checkouts').get().n, 0);
  assert.equal(other.files.size, 1, 'uncertain uploads remain for bucket lifecycle expiration');
});

test('photos are inaccessible at 72 hours and scheduled cleanup removes only expired objects', async () => {
  const {db, env, files} = fixture();
  for (const badge of ['ship-01','ship-02']) assert.equal((await call('/badges/api/badge/' + badge, env, {method:'POST', body:checkoutForm({photo:true})})).status, 201);
  const rows = db.prepare('SELECT * FROM checkouts ORDER BY badge').all();
  db.prepare('UPDATE checkouts SET checked_out_at=? WHERE id=?').run(new Date(Date.now() - 73*60*60*1000).toISOString(), rows[0].id);
  assert.equal((await call('/badges/api/record/' + rows[0].id + '/photo', env, {}, true)).status, 404);
  assert.equal((await call('/badges/api/record/' + rows[1].id + '/photo', env, {}, true)).status, 200);
  const history = await (await call('/badges/api/history', env, {}, true)).json();
  assert.equal(history.find(row => row.id === rows[0].id).has_photo, 0);
  const remove = env.BUCKET.delete;
  env.BUCKET.delete = async () => { throw new Error('temporary R2 outage'); };
  assert.equal(await deleteExpiredPhotos(env), 0);
  assert.ok(db.prepare('SELECT photo_key FROM checkouts WHERE id=?').get(rows[0].id).photo_key, 'failed cleanup retains the reference for retry');
  env.BUCKET.delete = remove;
  assert.equal(await deleteExpiredPhotos(env), 1);
  assert.equal(files.has(rows[0].photo_key), false);
  assert.equal(files.has(rows[1].photo_key), true);
  assert.equal(db.prepare('SELECT photo_key FROM checkouts WHERE id=?').get(rows[0].id).photo_key, null);
});

const b64 = value => Buffer.from(value).toString('base64url');
async function signer() {
  const keys = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'}, true, ['sign','verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey); jwk.kid = 'badge-test-key';
  const token = async claims => {
    const start = b64(JSON.stringify({alg:'RS256',kid:jwk.kid})) + '.' + b64(JSON.stringify({iss:'https://desk.cloudflareaccess.com',aud:['desk-audience'],exp:Math.floor(Date.now()/1000)+600,...claims}));
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(start));
    return start + '.' + b64(signature);
  };
  return {jwk,token};
}

test('Pages verifies Access signatures and requires owner or explicitly granted staff', async () => {
  const {env, scheduler} = fixture();
  const {jwk, token} = await signer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, 'https://desk.cloudflareaccess.com/cdn-cgi/access/certs');
    return Response.json({keys:[jwk]});
  };
  try {
    const viaPages = async (path, tokenValue, method = 'GET') => {
      const headers = tokenValue ? {'Cf-Access-Jwt-Assertion': tokenValue} : {'oai-authenticated-user-email':'owner@example.com'};
      return onRequest({request:req(path,{headers,method}),env,data:{}});
    };
    for (const path of ['/badges/history','/badges/api/history','/badges/api/history.xlsx','/badges/api/record/00000000-0000-0000-0000-000000000000/photo']) {
      assert.equal((await viaPages(path)).status, 401, path);
    }
    assert.equal((await viaPages('/badges/api/history', await token({email:'unapproved@example.com'}))).status, 403);
    assert.equal((await viaPages('/badges/api/history', await token({email:'owner@example.com',iss:'https://other.cloudflareaccess.com'}))).status, 403);
    assert.equal((await viaPages('/badges/api/history', await token({email:'owner@example.com',aud:['wrong']}))).status, 403);
    assert.equal((await viaPages('/badges/api/history', await token({email:'owner@example.com',exp:1}))).status, 403);
    const validOwner = await token({email:'owner@example.com'});
    const parts = validOwner.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    assert.equal((await viaPages('/badges/api/history', parts.join('.'))).status, 403);
    assert.equal((await viaPages('/badges/api/history', validOwner)).status, 200);
    scheduler.prepare('INSERT INTO private_permissions VALUES (?,?,?)').run('staff@example.com','badge_desk','view');
    const staff = await token({email:'staff@example.com'});
    assert.equal((await viaPages('/badges/api/history',staff)).status, 200);
    assert.equal((await viaPages('/badges/api/record/00000000-0000-0000-0000-000000000000/return',staff,'POST')).status, 403);
    scheduler.prepare('UPDATE private_permissions SET access_level=?').run('edit');
    assert.equal((await viaPages('/badges/api/record/00000000-0000-0000-0000-000000000000/return',staff,'POST')).status, 409);
  } finally { globalThis.fetch = originalFetch; }
});
