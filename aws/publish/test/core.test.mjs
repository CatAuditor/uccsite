// Publish-core tests with fake S3/CloudFront clients and the in-memory store:
// diff/put flow, run lifecycle (publishing → succeeded/failed), mass-delete
// guard, invalidation path shaping (encoding, dir-index, wildcard collapse).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publish, invalidationPaths, sha256, WILDCARD_THRESHOLD } = require('../core.js');
const { makeMemoryStore } = require('../store.js');

// ── invalidationPaths ───────────────────────────────────────────────────────

test('page keys get both spellings; index and dir-index map to their directory', () => {
  assert.deepEqual(new Set(invalidationPaths(['alpr.html'])), new Set(['/alpr.html', '/alpr']));
  assert.deepEqual(new Set(invalidationPaths(['index.html'])), new Set(['/index.html', '/']));
  assert.deepEqual(new Set(invalidationPaths(['admin/index.html'])), new Set(['/admin/index.html', '/admin']));
  assert.deepEqual(invalidationPaths(['css/styles.css']), ['/css/styles.css']);
});

test('paths are URL-encoded (spaces, unicode)', () => {
  const paths = invalidationPaths(['assets/uploads/Weber County Report.pdf']);
  assert.deepEqual(paths, ['/assets/uploads/Weber%20County%20Report.pdf']);
});

test('more than the threshold collapses to a single wildcard', () => {
  const keys = Array.from({ length: WILDCARD_THRESHOLD + 1 }, (_, i) => `f${i}.css`);
  assert.deepEqual(invalidationPaths(keys), ['/*']);
});

// ── Fake AWS clients ────────────────────────────────────────────────────────

function fakeClients({ objects = new Map(), failPut = false } = {}) {
  const invalidations = [];
  const s3 = {
    objects,
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === 'ListObjectsV2Command') {
        return { Contents: [...objects.keys()].map(Key => ({ Key })), IsTruncated: false };
      }
      if (name === 'HeadObjectCommand') {
        const o = objects.get(cmd.input.Key);
        if (!o) { const e = new Error('NotFound'); e.name = 'NotFound'; throw e; }
        return { Metadata: o.metadata };
      }
      if (name === 'PutObjectCommand') {
        if (failPut) throw new Error('S3 throttled');
        objects.set(cmd.input.Key, { body: cmd.input.Body, metadata: cmd.input.Metadata });
        return {};
      }
      if (name === 'GetObjectCommand') {
        const o = objects.get(cmd.input.Key);
        return { Body: (async function* () { yield o.body; })() };
      }
      if (name === 'DeleteObjectsCommand') {
        for (const { Key } of cmd.input.Delete.Objects) objects.delete(Key);
        return {};
      }
      throw new Error('unexpected s3 command ' + name);
    },
  };
  const cf = {
    invalidations,
    async send(cmd) {
      const name = cmd.constructor.name;
      if (name === 'CreateInvalidationCommand') {
        invalidations.push(cmd.input.InvalidationBatch.Paths.Items);
        return { Invalidation: { Id: 'INV1' } };
      }
      if (name === 'GetInvalidationCommand') return { Invalidation: { Status: 'Completed' } };
      throw new Error('unexpected cf command ' + name);
    },
  };
  return { s3, cf, invalidations };
}

const baseOpts = (clients, store, extra = {}) => ({
  s3: clients.s3, cf: clients.cf, bucket: 'b', distributionId: 'D', store, ...extra,
});

// ── Flow ────────────────────────────────────────────────────────────────────

test('first publish puts everything, verifies, records succeeded', async () => {
  const clients = fakeClients();
  const store = makeMemoryStore();
  const outputs = new Map([['index.html', Buffer.from('<a>')], ['css/s.css', Buffer.from('x')]]);
  const r = await publish({ ...baseOpts(clients, store), outputs });
  assert.equal(r.status, 'succeeded');
  assert.equal(r.changed.length, 2);
  assert.equal(clients.s3.objects.get('index.html').metadata.sha256, sha256(Buffer.from('<a>')));
  assert.equal(store.rows.at(-1).status, 'succeeded');
});

test('unchanged republish is a noop with a recorded row', async () => {
  const clients = fakeClients();
  const store = makeMemoryStore();
  const outputs = new Map([['a.html', Buffer.from('hi')]]);
  await publish({ ...baseOpts(clients, store), outputs });
  const r2 = await publish({ ...baseOpts(clients, store), outputs });
  assert.equal(r2.status, 'noop');
  assert.equal(store.rows.at(-1).status, 'noop');
  assert.equal(clients.invalidations.length, 1); // only the first run invalidated
});

test('only the changed key is put and invalidated', async () => {
  const clients = fakeClients();
  const store = makeMemoryStore();
  const v1 = new Map([['a.html', Buffer.from('one')], ['b.html', Buffer.from('two')]]);
  await publish({ ...baseOpts(clients, store), outputs: v1 });
  const v2 = new Map([['a.html', Buffer.from('one')], ['b.html', Buffer.from('CHANGED')]]);
  const r = await publish({ ...baseOpts(clients, store), outputs: v2 });
  assert.deepEqual(r.changed, ['b.html']);
  assert.deepEqual(new Set(clients.invalidations.at(-1)), new Set(['/b.html', '/b']));
});

test('a put failure records a failed row and rethrows', async () => {
  const store = makeMemoryStore();
  const clients = fakeClients({ failPut: true });
  const outputs = new Map([['a.html', Buffer.from('x')]]);
  await assert.rejects(() => publish({ ...baseOpts(clients, store), outputs }), /throttled/);
  const row = store.rows.at(-1);
  assert.equal(row.status, 'failed');
  assert.match(row.error, /throttled/);
});

test('the publishing row exists before any S3 write (intent-first)', async () => {
  const store = makeMemoryStore();
  let statusAtFirstPut;
  const clients = fakeClients();
  const origSend = clients.s3.send.bind(clients.s3);
  clients.s3.send = async (cmd) => {
    if (cmd.constructor.name === 'PutObjectCommand' && statusAtFirstPut === undefined) {
      statusAtFirstPut = store.rows.at(-1)?.status;
    }
    return origSend(cmd);
  };
  await publish({ ...baseOpts(clients, store), outputs: new Map([['a.html', Buffer.from('x')]]) });
  assert.equal(statusAtFirstPut, 'publishing');
});

test('bulk deletion is refused without the opt-in, allowed with it', async () => {
  const clients = fakeClients();
  const store = makeMemoryStore();
  const many = new Map(Array.from({ length: 10 }, (_, i) => [`f${i}.css`, Buffer.from('x')]));
  await publish({ ...baseOpts(clients, store), outputs: many });
  const few = new Map([['f0.css', Buffer.from('x')]]);
  await assert.rejects(() => publish({ ...baseOpts(clients, store), outputs: few }), /Refusing to delete/);
  const r = await publish({ ...baseOpts(clients, store), outputs: few, allowBulkDelete: true });
  assert.equal(r.removed.length, 9);
});

test('an empty outputs set is refused outright', async () => {
  const clients = fakeClients();
  await assert.rejects(() => publish({ ...baseOpts(clients, null), outputs: new Map() }), /empty outputs/);
});
