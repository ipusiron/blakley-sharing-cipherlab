'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../gf-core.js');
const P = require('../pitfalls.js');
const V = require('./vectors.json');
const root = path.join(__dirname, '..');
const docs = Object.fromEntries(['ja', 'en'].map(locale => [locale,
  fs.readFileSync(path.join(root, locale === 'ja' ? 'README.md' : 'README.en.md'), 'utf8')
]));
const slug = 'blakley-sharing-cipherlab';
const product = 'BlakleySharing CipherLab';
const excluded = new Set(['.git', '.work', 'backups', 'logs']);
const tableIds = ['default-k2', 'default-k3', 'shamir-k2', 'shamir-k3', 'whole-point', 'integer', 'narrow', 'tamper', 'share-size'];
const normalize = value => value.normalize('NFKC').replaceAll('−', '-').replaceAll('`', '').replaceAll('**', '');
const compact = value => normalize(value).replace(/\s+/g, '');
const numbers = value => (normalize(value).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
const range = length => Array.from({ length }, (_, i) => i);

function example(text, id) {
  const marker = new RegExp('<!--\\s*example:\\s*' + id + '\\s*-->', 'g');
  const matches = [...text.matchAll(marker)];
  assert.equal(matches.length, 1, 'one example marker: ' + id);
  return text.slice(matches[0].index + matches[0][0].length).trimStart().split(/\r?\n\s*\r?\n/)[0];
}
function rows(text, id, columns) {
  const lines = example(text, id).split(/\r?\n/);
  assert.ok(lines.length >= 3, id + ': Markdown table');
  assert.match(lines[1], /^\|\s*:?-+/);
  const parsed = lines.map(line => {
    assert.match(line, /^\|.*\|\s*$/, id + ': complete table row');
    const cells = line.trim().slice(1, -1).split('|').map(cell => cell.trim());
    assert.equal(cells.length, columns, id + ': column count');
    return cells;
  });
  return parsed.slice(2);
}
function numericTable(id, columns, expected) {
  for (const [locale, text] of Object.entries(docs)) {
    const actual = rows(text, id, columns);
    assert.equal(actual.length, expected.length, locale + ': ' + id + ' row count');
    assert.deepEqual(actual.map(row => row.flatMap(numbers)), expected, locale + ': ' + id);
  }
}
function polynomial(cell, p) {
  let expression = compact(cell.replaceAll('\u00b2', '^2')).replace(/^f\(x\)=/i, '');
  const annotated = expression.match(/^(.*?)\(mod(\d+)\)$/i);
  if (annotated) { assert.equal(Number(annotated[2]), p); expression = annotated[1]; }
  const terms = expression.match(/[+-]?[^+-]+/g) || [];
  assert.ok(terms.length > 0 && terms.join('') === expression, 'polynomial syntax: ' + cell);
  const coefficients = [0, 0, 0];
  for (const term of terms) {
    if (/^[+-]?\d+$/.test(term)) coefficients[0] += Number(term);
    else {
      const match = term.match(/^([+-]?)(?:(\d+)(?:[\u00b7*\u00d7])?)?x(?:\^([0-2]))?$/);
      assert.ok(match, 'polynomial term: ' + term);
      const value = (match[1] === '-' ? -1 : 1) * (match[2] === undefined ? 1 : Number(match[2]));
      coefficients[match[3] === undefined ? 1 : Number(match[3])] += value;
    }
  }
  return coefficients.map(value => G.mod(value, p));
}
function headings(text) {
  const content = text.replace(/<!--[\s\S]*?-->/g, '').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  return [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(match => ({ level: match[1].length, title: match[2] }));
}
function section(text, icon) {
  const start = text.search(new RegExp('^## ' + icon, 'm'));
  assert.ok(start >= 0, 'section ' + icon);
  const tail = text.slice(start);
  const end = tail.indexOf('\n## ', 1);
  return end < 0 ? tail : tail.slice(0, end);
}
function files(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    return entry.isDirectory() ? files(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}
function hasTuple(text, tuple, label) {
  assert.ok(compact(text).includes('(' + tuple.join(',') + ')'), label + ': tuple ' + tuple.join(','));
}
function hasNumbers(text, expected, label) {
  const found = numbers(text);
  for (const number of expected) assert.ok(found.includes(number), label + ': number ' + number);
}

test('README: Japanese block metadata identifies the tool and English has no duplicate metadata', () => {
  const match = docs.ja.match(/^<!--\s*\r?\n---\r?\n([\s\S]*?)\r?\n---\s*\r?\n(?:!)?-->/);
  assert.ok(match, 'HTML-comment YAML front matter');
  const metadata = {}, lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const entry = lines[i].match(/^([a-z_]+):\s*(.*)$/);
    assert.ok(entry, 'metadata line: ' + lines[i]);
    const [, key, scalar] = entry;
    assert.equal(metadata[key], undefined, 'no duplicate key: ' + key);
    if (scalar) metadata[key] = scalar.replace(/^(['"])(.*)\1$/, '$2');
    else {
      metadata[key] = [];
      while (i + 1 < lines.length && /^  - \S/.test(lines[i + 1])) metadata[key].push(lines[++i].slice(4));
      assert.ok(metadata[key].length > 0, 'block list: ' + key);
    }
  }
  for (const [key, value] of Object.entries({
    id: 'day126', slug, title: product, hub: 'true',
    repo_url: 'https://github.com/ipusiron/' + slug, demo_url: 'https://ipusiron.github.io/' + slug + '/'
  })) assert.equal(metadata[key], value, key);
  assert.deepEqual(metadata.category_ja, ['現代暗号', '情報理論']);
  assert.deepEqual(metadata.category_en, ['Modern Cryptography', 'Information Theory']);
  for (const key of ['subtitle_ja', 'subtitle_en', 'description_ja', 'description_en']) {
    assert.equal(typeof metadata[key], 'string', key);
    assert.ok(metadata[key].length > 0, key);
  }
  assert.match(metadata.difficulty, /^[1-5]$/);
  assert.ok(Array.isArray(metadata.tags) && metadata.tags.length > 0, 'block tags');
  assert.doesNotMatch(docs.en, /^\s*(?:id|slug|category_ja|repo_url|demo_url|hub):/m);
});

test('README: opening, language links, series badges and learning-only warning', () => {
  assert.match(docs.ja, /BlakleySharing CipherLabは、[^。]+教材です。/);
  assert.match(docs.ja, /\[English\]\(README\.en\.md\)/);
  assert.match(docs.en.split(/\r?\n/)[0], /^English · \[日本語\]\(README\.md\)$/);
  assert.match(docs.ja, /学習用/);
  assert.match(docs.ja, /本物の秘密[^。\n]*(?:入れない|入力しない)/);
  assert.match(docs.en, /(?:do not|never)[^.\n]*(?:real|actual)[^.\n]*secret/i);
  for (const text of Object.values(docs)) {
    assert.match(text, /^# BlakleySharing CipherLab - .+$/m);
    assert.match(text, /Day126/);
    assert.match(text, /200/);
    assert.ok(text.includes('https://akademeia.info/?page_id=44607'));
    for (const badge of ['stars', 'forks', 'last-commit', 'license']) {
      assert.ok(text.includes('img.shields.io/github/' + badge + '/ipusiron/' + slug), badge);
    }
    assert.match(text, /img\.shields\.io\/badge\/demo-GitHub%20Pages/);
    assert.match(text, /npm test/);
    assert.match(text, /Node(?:\.js)?\s*22/);
  }
});

test('README: Japanese and English heading hierarchy and fixed section order match', () => {
  const ja = headings(docs.ja), en = headings(docs.en);
  assert.ok(ja.length >= 10, 'substantial README structure');
  assert.deepEqual(ja.map(item => item.level), en.map(item => item.level), 'same hierarchy and heading count');
  const icons = list => list.filter(item => item.level === 2).map(item => item.title.split(' ')[0]);
  const expected = icons(ja);
  assert.deepEqual(icons(en), expected, 'corresponding section order');
  assert.deepEqual(expected.slice(0, 2), ['🌐', '📸']);
  assert.deepEqual(expected.slice(-4), ['📁', '💻', '📄', '🛠️']);
  assert.ok(expected.includes('🧪') && expected.includes('🔒'));
  for (const list of [ja, en]) for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].level <= list[i - 1].level + 1, 'heading levels do not skip');
  }
  assert.match(docs.ja, /このツールならではの使い方/);
  assert.match(docs.en, /Ways of using this tool in particular/i);
});

test('README: default k=2 normals, modular values and integer values are recomputed', () => {
  const v = V.default_k2, integer = P.integerShares(v.A, v.X).c;
  assert.deepEqual(v.A.map(row => G.dot(row, v.X, v.p)), v.c);
  assert.deepEqual(integer, v.cInt);
  numericTable('default-k2', 4, v.A.map((row, i) => [i + 1, ...row, v.c[i], integer[i]]));
});

test('README: default k=3 normals and right-hand values are recomputed', () => {
  const v = V.default_k3, values = v.A.map(row => G.dot(row, v.X, v.p));
  assert.deepEqual(values, v.c);
  numericTable('default-k3', 3, v.A.map((row, i) => [i + 1, ...row, values[i]]));
});

test('README: Shamir k=2 share values match the reference polynomial', () => {
  const v = V.shamir_k2, normals = G.vandermonde(v.p, v.X.length, v.A.length);
  assert.deepEqual(normals, v.A);
  const values = normals.map(row => G.dot(row, v.X, v.p));
  assert.deepEqual(values, v.c);
  numericTable('shamir-k2', 2, values.map((value, i) => [i + 1, value]));
});

test('README: all Shamir k=3 correspondence rows evaluate to the observed pair', () => {
  const v = V.shamir, points = G.solutionPoints(v.A.slice(0, 2), v.c.slice(0, 2), v.p);
  assert.deepEqual(points, v.line12);
  for (const [locale, text] of Object.entries(docs)) {
    const actual = rows(text, 'shamir-k3', 5);
    assert.equal(actual.length, points.length, locale + ': all polynomial candidates');
    for (const [i, row] of actual.entries()) {
      const point = points[i], coefficients = polynomial(row[2], v.p);
      assert.deepEqual(numbers(row[0]), [point[0]], locale + ': secret column');
      assert.deepEqual(numbers(row[1]), point, locale + ': coefficient point');
      assert.deepEqual(coefficients, point, locale + ': polynomial coefficients');
      assert.deepEqual(row.slice(3).flatMap(numbers), v.A.slice(0, 2).map(normal => G.dot(normal, point, v.p)));
      for (const x of range(v.p)) {
        const value = G.mod(coefficients[0] + coefficients[1] * x + coefficients[2] * x * x, v.p);
        assert.equal(value, G.dot([1, x, G.mod(x * x, v.p)], point, v.p), locale + ': polynomial at ' + x);
      }
    }
  }
});

test('README: whole-point and first-coordinate candidate counts are recomputed', () => {
  const expected = [V.default_k2, V.default_k3].map(v => {
    const k = v.X.length, counts = range(k + 1);
    const whole = counts.map(count => P.pointCandidates(v.A, v.c, v.p, count));
    const secrets = counts.map(count => G.sCandidates(v.A.slice(0, count), v.c.slice(0, count), v.p, k).filter(Boolean).length);
    assert.deepEqual(whole, v.pointWhole);
    return [k, v.p, ...counts, ...whole, ...secrets];
  });
  numericTable('whole-point', 5, expected);
});

test('README: integer equations leave exactly the listed secret candidates', () => {
  const v = V.default_k2, right = P.integerShares(v.A, v.X).c;
  const candidates = v.A.map((row, i) => P.integerCandidates(row, right[i], v.p));
  assert.deepEqual(candidates, v.integerCandidates);
  numericTable('integer', 3, candidates.map((values, i) => [i + 1, right[i], ...values]));
});

test('README: restricted randomness uses its own valid example and four candidates', () => {
  const v = V.default_k2, rng = length => { const bytes = new Uint8Array(length); bytes[0] = 1; return bytes; };
  const narrow = P.narrowShares([v.A[0]], v.p, 0, rng);
  const points = P.narrowCandidates(narrow.A, narrow.c, v.p);
  numericTable('narrow', 4, [[...narrow.X, ...narrow.A[0], narrow.c[0], ...points.map(point => point[0])]]);
});

test('README: every two-share reconstruction in the tampered example matches the vectors', () => {
  const v = V.default_k2, c = v.c.slice();
  c[V.tamper_k2.changed.share - 1] = V.tamper_k2.changed.to;
  const pairs = [...G.combinations(v.A.length, v.X.length)].map(T => ({
    T: T.map(i => i + 1), X: G.solve(T.map(i => v.A[i]), T.map(i => c[i]), v.p)
  }));
  assert.deepEqual(pairs, V.tamper_k2.pairs);
  numericTable('tamper', 3, pairs.map(pair => [...pair.T, ...pair.X, pair.X[0]]));
});

test('README: normalized share-size formulas give the stated counts', () => {
  const k = V.shamir.X.length;
  const values = [m => m * k, m => m + k - 1, m => m];
  for (const [locale, text] of Object.entries(docs)) {
    const actual = rows(text, 'share-size', 4);
    assert.equal(actual.length, values.length, locale + ': share-size row count');
    const formulas = actual.map(row => compact(row[1]).replace(/[·×*]/g, ''));
    assert.deepEqual(formulas, ['mk', 'm+k-1', 'm']);
    assert.deepEqual(actual.map(row => row.slice(2).flatMap(numbers)), values.map(fn => [fn(1), fn(16)]));
  }
});

test('README: nonzero, linearity and leaking-plane explanations use computed values', () => {
  const v = V.shamir, compatible = G.solutionPoints(v.A.slice(0, 2), v.c.slice(0, 2), v.p);
  const restricted = P.nonzeroCandidates(v.A.slice(0, 2), v.c.slice(0, 2), v.p);
  const removed = compatible.filter(point => !restricted.some(other => point.every((value, i) => value === other[i])));
  const line = V.tamper_linearity;
  const u = G.solve(line.A[0].map((_, j) => line.A.map(row => row[j])), G.e1(line.A.length), line.p);
  assert.deepEqual(u, line.u);
  const base = G.solve(line.A, line.c, line.p)[0], changed = line.c.slice();
  changed[line.shiftedShare - 1] = G.mod(changed[line.shiftedShare - 1] + 1, line.p);
  const shifted = G.solve(line.A, changed, line.p)[0];
  assert.equal(shifted, line.sByDelta[1]);
  const leak = V.leak_k3, candidates = G.sCandidates(leak.A, leak.c, leak.p);
  assert.deepEqual(candidates, leak.sCandidates);
  const secret = candidates.findIndex(Boolean);
  for (const text of Object.values(docs)) {
    const nz = example(text, 'nonzero'), linear = example(text, 'linearity'), leaking = example(text, 'leak3');
    hasNumbers(nz, [compatible.length, restricted.length, ...removed.map(point => point[0])], 'nonzero');
    hasTuple(linear, u, 'linearity');
    hasNumbers(linear, [1, base, shifted], 'linearity');
    for (const row of leak.A) hasTuple(leaking, row, 'leak3');
    hasTuple(leaking, leak.c, 'leak3');
    hasNumbers(leaking, [secret, candidates[secret]], 'leak3');
    for (const id of tableIds) assert.ok(example(text, id).length > 0);
  }
});

test('README: both documented trees include every public file with a comment on every line', () => {
  const actual = files();
  for (const [locale, text] of Object.entries(docs)) {
    const fence = section(text, '📁').match(/```[^\n]*\n([\s\S]*?)\n```/);
    assert.ok(fence, locale + ': directory tree code block');
    const tree = fence[1].split(/\r?\n/).filter(line => line.trim());
    const listed = [];
    for (const line of tree) {
      assert.match(line, /\s# \S/, locale + ': explanation on tree line: ' + line);
      const match = line.match(/^(?:\|--|[├└]──)\s+(\S+)\s+# \S/);
      if (match && !match[1].endsWith('/')) listed.push(match[1]);
      else assert.match(line, /\/$|\/\s+# /, 'root or directory line');
    }
    assert.deepEqual(listed.sort(), actual, locale + ': public files');
  }
});

test('README: six localized PNG screenshots exist, have dimensions and stay below 300000 bytes', () => {
  const names = ['screenshot.png', 'screenshot2.png', 'screenshot3.png'];
  const expectedAll = [];
  for (const [locale, text] of Object.entries(docs)) {
    const expected = names.map(name => 'assets/' + (locale === 'en' ? 'en/' : '') + name);
    const references = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
      .map(match => match[1]).filter(value => !/^https?:/.test(value));
    assert.deepEqual([...new Set(references)].sort(), expected.slice().sort(), locale + ': image language and names');
    expectedAll.push(...expected);
    for (const image of expected) {
      const png = fs.readFileSync(path.join(root, image));
      assert.ok(png.length > 33 && png.length <= 300000, image + ': PNG size ' + png.length);
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', image + ': PNG signature');
      assert.equal(png.subarray(12, 16).toString(), 'IHDR', image + ': dimensions');
      assert.ok(png.readUInt32BE(16) >= 320 && png.readUInt32BE(20) >= 200, image + ': readable viewport dimensions');
    }
  }
  assert.deepEqual(files().filter(file => /^assets\/.*\.png$/.test(file)), expectedAll.sort(), 'no unused screenshot PNGs');
});

test('README: related tool names and URLs agree and wording remains within the learning scope', () => {
  const related = [
    ['ShamirSharing CipherLab', 'shamir-sharing-cipherlab'], ['VisualCryptography CipherLab', 'visual-cryptography-cipherlab'],
    ['Scatter Seeds', 'scatter-seeds'], ['Overlay QR Shares', 'overlay-qr-shares'], ['OTP Animation', 'otp-animation']
  ];
  for (const text of Object.values(docs)) for (const [name, route] of related) {
    assert.ok(text.includes(name), name);
    assert.ok(text.includes('https://ipusiron.github.io/' + route + '/'), route);
  }
  assert.doesNotMatch(docs.ja, /照合|突き合わせ|効く|走る|向き|表向き|共有|安全に保管できる|本物の秘密を分けて|世界初/);
  assert.doesNotMatch(docs.ja, /渚の誤り|改修前は|以前は.*誤り/);
  assert.match(docs.ja, /法線[^。\n]*(?:再利用|使い回)[^。\n]*(?:よい|可|でき)/);
  assert.match(docs.en, /normals[^.\n]*(?:reused|reus|public)/i);
  assert.match(docs.ja, /(?:x₂|x_2|乱数の座標)[\s\S]{0,200}(?:使い回してはならない|再利用しない|使い回さない)/);
});

test('README: original, secondary-source readings and derived constructions are distinguished', () => {
  const ja = docs.ja, en = docs.en;
  for (const text of [ja, en]) {
    for (const name of ['HAC', 'Bose', 'Ball', 'Beimel']) assert.ok(text.includes(name), name);
    assert.ok(text.includes('10.4171/JEMS/316'));
    assert.ok(text.includes('10.1109/MARK.1979.8817296'));
    assert.match(compact(text), /2(?:≤|<=)k(?:≤|<=)p/);
  }
  assert.match(ja, /HAC[\s\S]{0,650}(?:このツール|本ツール)[^。\n]*読み/);
  assert.match(en, /HAC[\s\S]{0,900}(?:this tool|our)[^.\n]*(?:reading|interpretation)/i);
  assert.match(ja, /(?:明示|一次資料)[\s\S]{0,150}(?:見つか|未発見)/);
  assert.match(en, /(?:primary source[\s\S]{0,180}(?:not found|not been found)|no primary source|did not find a primary source)/i);
  assert.match(ja, /Bose[^\n]*(?:本文未確認|本文は未確認)/);
  assert.match(en, /Bose[^\n]*(?:text unchecked|text not checked|not checked|not read|unread)/i);
  assert.match(ja, /(?:pは素数|素数p|pが素数)/);
  assert.match(en, /(?:prime p|p (?:is )?prime)/i);
});
