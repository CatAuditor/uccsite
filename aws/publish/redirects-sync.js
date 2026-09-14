'use strict';
// Sync the redirects table into the CloudFront KeyValueStore the
// viewer-request function reads (infra/cdk/cf-fn/viewer-request.js). Runs
// inside every publish (Lambda and CLI) AFTER the site files are live, so a
// redirect never points at a page that isn't there yet. The database is
// authoritative: keys in the store that are not active rows are deleted.
// KVS writes are optimistic (ETag); the whole sync retries once on a
// conflict (another publish is excluded by publish_lock anyway).
const {
  CloudFrontKeyValueStoreClient, DescribeKeyValueStoreCommand, ListKeysCommand, UpdateKeysCommand,
} = require('@aws-sdk/client-cloudfront-keyvaluestore');
const { SignatureV4MultiRegion } = require('@aws-sdk/signature-v4-multi-region');
require('@aws-sdk/signature-v4a'); // registers the pure-JS SigV4A implementation the multi-region signer looks for

// syncRedirects({ kvsArn, entries: [{key, value}], region, log }) → { put, deleted }
async function syncRedirects({ kvsArn, entries, region, log = () => {} }) {
  // The KVS data plane is SigV4A-signed (multi-region); the SDK needs the
  // multi-region signer wired explicitly.
  const kvs = new CloudFrontKeyValueStoreClient({ region, signerConstructor: SignatureV4MultiRegion });
  const wanted = new Map(entries.map(e => [e.key, e.value]));

  for (let attempt = 0; attempt < 2; attempt++) {
    const desc = await kvs.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
    const existing = new Map();
    let token;
    do {
      const page = await kvs.send(new ListKeysCommand({ KvsARN: kvsArn, NextToken: token, MaxResults: 50 }));
      for (const item of page.Items || []) existing.set(item.Key, item.Value);
      token = page.NextToken;
    } while (token);

    const puts = [...wanted].filter(([k, v]) => existing.get(k) !== v).map(([Key, Value]) => ({ Key, Value }));
    const deletes = [...existing.keys()].filter(k => !wanted.has(k)).map(Key => ({ Key }));
    if (!puts.length && !deletes.length) { log('redirects: KeyValueStore already in sync'); return { put: 0, deleted: 0 }; }
    try {
      await kvs.send(new UpdateKeysCommand({ KvsARN: kvsArn, IfMatch: desc.ETag, Puts: puts.length ? puts : undefined, Deletes: deletes.length ? deletes : undefined }));
      log(`redirects: KeyValueStore updated (${puts.length} put, ${deletes.length} deleted)`);
      return { put: puts.length, deleted: deletes.length };
    } catch (err) {
      if (err.name !== 'ValidationException' && err.name !== 'ConflictException') throw err;
      log(`redirects: KeyValueStore ETag conflict, retrying (${err.name})`);
    }
  }
  throw new Error('redirects: KeyValueStore sync failed after retry');
}

module.exports = { syncRedirects };
