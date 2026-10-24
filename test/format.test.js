'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('F: readable source lines and UTF-8 without BOM', () => {
  const files = fs.readdirSync(root).filter(f => /\.(js|css|html|json)$/.test(f));
  files.push(...fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).map(f => 'test/' + f));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.notEqual(text.charCodeAt(0), 0xFEFF, file);
    const limit = file.endsWith('.html') ? 250 : 160;
    for (const [i, line] of text.split(/\r?\n/).entries()) assert.ok([...line].length <= limit, `${file}:${i + 1} exceeds ${limit}`);
  }
  for (const [file, minimum] of [['app.js', 40], ['style.css', 80], ['index.html', 50], ['gf-core.js', 100]]) {
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').split('\n').length >= minimum, file);
  }
});
