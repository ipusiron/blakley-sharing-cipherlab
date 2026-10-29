'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const scripts = ['theme-init.js', 'gf-core.js', 'pitfalls.js', 'messages.js', 'app.js'];
test('F: strict offline CSP, standard scripts and semantic shell', () => {
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    + "base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";
  assert.ok(html.includes(`content="${csp}"`));
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /rel="icon" href="data:,"/);
  assert.match(html, /<noscript>/);
  assert.doesNotMatch(html, /<script[^>]*type="module"|<script(?![^>]*src=)[^>]*>|\sstyle=|\son\w+=/);
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  assert.match(html, /<dialog id="help-dialog"/);
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]), scripts);
  for (const code of scripts.map(read)) {
    assert.doesNotMatch(code, /Math\.random\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|innerHTML/);
    assert.doesNotMatch(code, /\.style\.|setAttribute\(\s*['"]style['"]/);
  }
  assert.doesNotMatch(read('gf-core.js'), /require\([^)]*pitfalls/);
});
test('F: public UMD APIs and only preference persistence', () => {
  for (const [file, name] of [['gf-core.js', 'BlakleyGF'], ['pitfalls.js', 'BlakleyPitfalls'], ['messages.js', 'BlakleyMessages']]) {
    assert.ok(read(file).includes(name));
    assert.equal(typeof require('../' + file), 'object');
  }
  const writes = [...read('app.js').matchAll(/localStorage\.setItem\('([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(writes, ['blakley-sharing-cipherlab.language', 'blakley-sharing-cipherlab.theme']);
  assert.doesNotMatch(read('app.js'), /history\.(?:pushState|replaceState)|location\.hash\s*=/);
  assert.match(read('style.css'), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});
