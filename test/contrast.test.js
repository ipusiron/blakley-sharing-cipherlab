'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const variables = body => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(m => [m[1], m[2]]));
const light = variables(css.match(/:root\s*\{([^}]+)\}/)[1]);
const dark = { ...light, ...variables(css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1]) };
const luminance = color => {
  const c = color.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
test('F: text contrast in both themes and specified paper and purple ink', t => {
  assert.equal(light.bg, '#f6f4ed'); assert.equal(light.paper, '#fffdf7'); assert.equal(light.accent, '#5e3a87');
  assert.equal(dark.bg, '#0d1b2d'); assert.equal(dark.paper, '#172940'); assert.equal(dark.accent, '#c9a8f0');
  for (const [theme, colors] of [['light', light], ['dark', dark]]) {
    const pairs = ['ink', 'muted', 'accent', 'red'].flatMap(ink => ['bg', 'paper'].map(bg => [ink, bg]));
    pairs.push(['on-accent', 'accent']);
    for (const [ink, bg] of pairs) {
      const ratio = contrast(colors[ink], colors[bg]);
      t.diagnostic(`${theme} ${ink} ${colors[ink]} / ${bg} ${colors[bg]} = ${ratio.toFixed(2)}:1`);
      assert.ok(ratio >= 4.5, `${theme} ${ink}/${bg}: ${ratio}`);
    }
    for (const bg of ['bg', 'paper']) assert.ok(contrast(colors.focus, colors[bg]) >= 3);
  }
});
