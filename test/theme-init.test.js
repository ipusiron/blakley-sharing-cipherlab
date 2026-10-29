'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const key = 'blakley-sharing-cipherlab.theme';

function run({ saved = null, dark = false, getThrows = false, propertyThrows = false, media = true } = {}) {
  const reads = [], writes = [], queries = [];
  const dataset = { appReady: 'false' };
  const storage = {
    getItem(name) {
      reads.push(name);
      if (getThrows) throw new Error('storage blocked');
      return saved;
    },
    setItem(...args) { writes.push(['setItem', ...args]); },
    removeItem(...args) { writes.push(['removeItem', ...args]); },
    clear(...args) { writes.push(['clear', ...args]); }
  };
  const window = { document: { documentElement: { dataset } } };
  Object.defineProperty(window, 'localStorage', {
    get() {
      if (propertyThrows) throw new Error('storage access blocked');
      return storage;
    }
  });
  if (media) {
    window.matchMedia = query => {
      queries.push(query);
      return { matches: dark };
    };
  }
  vm.runInNewContext(read('theme-init.js'), { window }, { timeout: 1000 });
  assert.deepEqual(reads, propertyThrows ? [] : [key]);
  assert.deepEqual(writes, [], 'initial resolution must not save an implicit preference');
  assert.ok(queries.every(query => query === '(prefers-color-scheme: dark)'));
  assert.equal(dataset.appReady, 'false', 'theme initialization must not signal app readiness');
  assert.deepEqual(Object.keys(dataset).sort(), ['appReady', 'theme']);
  return dataset.theme;
}

test('theme-init follows the OS when no explicit theme is saved', () => {
  assert.equal(run({ dark: false }), 'light');
  assert.equal(run({ dark: true }), 'dark');
});

test('theme-init prefers an explicit saved theme over the opposite OS theme', () => {
  assert.equal(run({ saved: 'light', dark: true }), 'light');
  assert.equal(run({ saved: 'dark', dark: false }), 'dark');
});

test('theme-init ignores invalid saved themes without persisting a replacement', () => {
  for (const saved of ['', 'blue', 'DARK', ' light ', 'null']) {
    assert.equal(run({ saved, dark: false }), 'light');
    assert.equal(run({ saved, dark: true }), 'dark');
  }
});

test('theme-init tolerates getItem errors and keeps the OS choice', () => {
  assert.equal(run({ getThrows: true, dark: false }), 'light');
  assert.equal(run({ getThrows: true, dark: true }), 'dark');
});

test('theme-init tolerates access errors on the localStorage property', () => {
  assert.equal(run({ propertyThrows: true, dark: false }), 'light');
  assert.equal(run({ propertyThrows: true, dark: true }), 'dark');
});

test('theme-init defaults to light without matchMedia and still honors saved choices', () => {
  assert.equal(run({ media: false }), 'light');
  assert.equal(run({ media: false, saved: 'dark' }), 'dark');
});

test('the head loads theme-init synchronously after CSS and before deferred app scripts', () => {
  const html = read('index.html');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.match(head, /<link rel="stylesheet" href="style\.css">\s*<script src="theme-init\.js"><\/script>/);
  const tags = [...head.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)];
  const initializers = tags.filter(match => /\bsrc="theme-init\.js"/.test(match[0]));
  assert.equal(initializers.length, 1, 'one external theme initializer belongs in head');
  const initializer = initializers[0];
  assert.doesNotMatch(initializer[0], /\b(?:async|defer)\b|\btype\s*=/);
  assert.match(initializer[0], /^<script src="theme-init\.js"><\/script>$/);
  assert.ok(head.indexOf('http-equiv="Content-Security-Policy"') < initializer.index);
  assert.ok(head.indexOf('href="style.css"') >= 0 && head.indexOf('href="style.css"') < initializer.index);
  for (const name of ['gf-core.js', 'pitfalls.js', 'messages.js', 'app.js']) {
    const matches = tags.filter(match => match[0].includes('src="' + name + '"'));
    assert.equal(matches.length, 1);
    assert.ok(matches[0].index > initializer.index, name + ' must follow theme initialization');
    assert.match(matches[0][0], /\bdefer\b/);
  }
});
