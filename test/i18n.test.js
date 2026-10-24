'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../messages.js');
test('F: Japanese and English keys, placeholders and HTML labels match', () => {
  assert.deepEqual(Object.keys(M.ja).sort(), Object.keys(M.en).sort());
  const placeholders = s => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]).sort();
  for (const key of Object.keys(M.ja)) {
    assert.deepEqual(placeholders(M.ja[key]), placeholders(M.en[key]), key);
    assert.doesNotMatch(M.ja[key], /照合|突き合わせ|効く|走る|向き|表向き|共有|安全に保管できる|本物の秘密を分けて/, key);
    if (!key.startsWith('lesson')) assert.doesNotMatch(M.ja[key], /e₁|射影|MDS/, key);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const match of html.matchAll(/data-(?:i18n|label)="([^"]+)"/g)) assert.ok(Object.hasOwn(M.ja, match[1]), match[1]);
});
