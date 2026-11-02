'use strict';
// Accessibility rules that can be checked without a browser: live regions, disabled-control notes and view-opening buttons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../messages.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('app.js'), html = read('index.html');
const liveIds = [...html.matchAll(/<[a-z]+\b[^>]*\bid="([^"]+)"[^>]*\b(?:role="(?:status|alert)"|aria-live=)/g)].map(m => m[1]);

test('A: setLiveText writes a live region only when its sentence changes', () => {
  const source = app.match(/const setLiveText = [^\n]+/)[0];
  const setLiveText = vm.runInNewContext(source + '\nsetLiveText;');
  let writes = 0, text = '';
  const element = { get textContent() { return text; }, set textContent(value) { writes++; text = value; } };
  setLiveText(element, '');
  setLiveText(element, 'one point');
  setLiveText(element, 'one point');
  setLiveText(element, 'one point');
  setLiveText(element, 'no point');
  assert.equal(writes, 2);
  assert.equal(text, 'no point');
});

test('A: every live region written by app.js goes through setLiveText', () => {
  assert.ok(liveIds.includes('status') && liveIds.includes('recovery-result') && liveIds.length >= 10, liveIds.join(','));
  for (const id of liveIds) {
    const direct = new RegExp(String.raw`\$\('${id}'\)\.(?:textContent|innerText)\s*=|\$\('${id}'\)\.(?:replaceChildren|append)\(`);
    assert.doesNotMatch(app, direct, id);
  }
});

test('A: dragging the 3D diagram and resizing do not re-render the whole page per event', () => {
  const move = app.match(/\$\('scene'\)\.addEventListener\('pointermove', event => \{([\s\S]*?)\n {4}\}\);/)[1];
  assert.match(move, /renderCamera\(/);
  assert.doesNotMatch(move, /\brender\(/);
  const resize = app.match(/window\.addEventListener\('resize', \(\) => \{([\s\S]*?)\n {4}\}\);/)[1];
  assert.match(resize, /requestAnimationFrame/);
  const camera = app.match(/function renderCamera\(example\) \{([\s\S]*?)\n {2}\}/)[1];
  for (const id of liveIds) assert.ok(!camera.includes(`'${id}'`), id);
});

test('B: disabled −1/+1 are described by a translated note', () => {
  assert.match(html, /<p id="edit-disabled-note"[^>]*\bhidden\b[^>]*data-i18n="editNeedsShare"/);
  for (const language of ['ja', 'en']) assert.ok(M[language].editNeedsShare.includes('−1'), language);
  assert.match(app, /setAttribute\('aria-describedby', 'edit-disabled-note'\)/);
  assert.match(app, /removeAttribute\('aria-describedby'\)/);
});

test('C: the theory-8 button names the dialog it opens and looks like navigation', () => {
  const button = html.match(/<button id="compare-lesson"[^>]*>/)[0];
  assert.match(button, /class="nav-button"/);
  assert.match(button, /aria-haspopup="dialog"/);
  for (const language of ['ja', 'en']) assert.ok(M[language].compareLesson.includes(M[language].help), language);
  assert.match(read('style.css'), /\.nav-button::after \{[^}]*content: "→"/);
});
