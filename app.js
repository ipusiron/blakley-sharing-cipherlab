/* BlakleySharing CipherLab - MIT (c) 2026 ipusiron. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const stored = key => {
    try { return localStorage.getItem('blakley-sharing-cipherlab.' + key); } catch (_) { return null; }
  };
  const validLanguage = value => ['ja', 'en'].includes(value) ? value : null;
  const queryLanguage = validLanguage(new URLSearchParams(location.search).get('lang'));
  const savedTheme = stored('theme');
  const DEFAULTS = {
  "2": {
    "p": 13,
    "X": [
      5,
      8
    ],
    "A": [
      [
        1,
        3
      ],
      [
        2,
        5
      ],
      [
        4,
        2
      ],
      [
        5,
        1
      ]
    ],
    "c": [
      3,
      11,
      10,
      7
    ],
    "k": 2,
    "n": 4
  },
  "3": {
    "p": 11,
    "X": [
      7,
      2,
      9
    ],
    "A": [
      [
        1,
        2,
        3
      ],
      [
        4,
        1,
        5
      ],
      [
        2,
        7,
        1
      ],
      [
        3,
        1,
        1
      ],
      [
        1,
        1,
        3
      ]
    ],
    "c": [
      5,
      9,
      4,
      10,
      3
    ],
    "k": 3,
    "n": 5
  },
  "4": {
    "p": 13,
    "X": [
      5,
      8,
      2,
      9
    ],
    "A": [
      [
        3,
        3,
        2,
        4
      ],
      [
        2,
        2,
        5,
        3
      ],
      [
        3,
        1,
        2,
        2
      ],
      [
        1,
        3,
        1,
        2
      ],
      [
        5,
        2,
        2,
        1
      ],
      [
        2,
        2,
        1,
        3
      ]
    ],
    "c": [
      1,
      11,
      6,
      10,
      2,
      3
    ],
    "k": 4,
    "n": 6
  },
  "5": {
    "p": 13,
    "X": [
      5,
      8,
      2,
      9,
      4
    ],
    "A": [
      [
        2,
        3,
        2,
        4,
        2
      ],
      [
        3,
        3,
        5,
        2,
        2
      ],
      [
        3,
        1,
        1,
        5,
        1
      ],
      [
        2,
        1,
        5,
        3,
        1
      ],
      [
        1,
        3,
        2,
        5,
        3
      ],
      [
        1,
        1,
        1,
        4,
        3
      ]
    ],
    "c": [
      4,
      10,
      9,
      7,
      12,
      11
    ],
    "k": 5,
    "n": 6
  }
};
  const state = {
    language: queryLanguage || validLanguage(stored('language')) || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
    theme: ['light', 'dark'].includes(savedTheme) ? savedTheme
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    tab: 'intersections',
    example: { p: 13, k: 2, n: 4, X: [5, 8], A: [[1, 3], [2, 5], [4, 2], [5, 1]], c: [3, 11, 10, 7] },
    selected: [0], candidate: 0, all: false, busy: false, kind: 'fixed', edits: null, method: 'random',
    editShare: 0, guides: false, mathGuides: true, mathApproach: 'folded', failuresOnly: false, matrixStep: 0, matrixCount: 1,
    yaw: 35, pitch: 25, visible: [true, true, true, true], drag: null, notice: null,
    pitBK: 2,
    pitBCount: 0,
    pitCMode: "integer",
    pitCShare: 0,
    pitAMode: "vertical",
    pitASlice: 7,
    pitDCount: 2,
    pitDDelta: 1,
    compareK2Candidate: 0,
    compareCandidate: 0,
    compareNonzero: false,
    compareGuides: true
  };
  const tabs = ['intersections', 'dimensions', 'compare', 'pitfalls'];
  const t = (key, values = {}) => (BlakleyMessages[state.language][key] || key)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(values[name] ?? '{' + name + '}'));
  function save() {
    try {
      localStorage.setItem('blakley-sharing-cipherlab.language', state.language);
      localStorage.setItem('blakley-sharing-cipherlab.theme', state.theme);
    } catch (_) { /* Preferences are optional. */ }
  }
  function render() {
    const focusId = document.activeElement?.id;
    document.documentElement.lang = state.language;
    document.documentElement.dataset.theme = state.theme;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.label)); });
    document.querySelectorAll('[data-cell-label]').forEach(el => { el.dataset.label = t(el.dataset.cellLabel); });
    $('language').textContent = state.language === 'ja' ? 'EN' : '日';
    for (const name of tabs) {
      const selected = name === state.tab;
      $('tab-' + name).setAttribute('aria-selected', String(selected));
      $('tab-' + name).tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
    const destination = $(activeExperiment + '-workbench'), workbench = $('workbench');
    if (workbench.parentElement !== destination) destination.append(workbench);
    workbench.dataset.experiment = activeExperiment;
    renderIntersections();
    renderPitfalls();
    renderCompare();
    if (focusId && $(focusId)?.getClientRects().length) $(focusId).focus({ preventScroll: true });
  }
  tabs.forEach((name, index) => {
    $('tab-' + name).addEventListener('click', () => selectTab(name));
    $('tab-' + name).addEventListener('keydown', event => {
      const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!move && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + move + tabs.length) % tabs.length;
      selectTab(tabs[next]); $('tab-' + state.tab).focus();
    });
  });
  $('theme').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); render(); });
  $('language').addEventListener('click', () => { state.language = state.language === 'ja' ? 'en' : 'ja'; save(); render(); });
  $('help').addEventListener('click', () => { $('help-dialog').showModal(); document.querySelector('.help-body').scrollTop = 0; });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  function visibleFocusTarget(element) {
    if (element.matches(':disabled') || !element.getClientRects().length) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  }
  $('help-dialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...$('help-dialog').querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter(visibleFocusTarget);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const G = BlakleyGF;
  const P = BlakleyPitfalls;
  const clone = value => JSON.parse(JSON.stringify(value));
  const experimentKeys = [
    'example', 'selected', 'candidate', 'all', 'kind', 'edits', 'method', 'editShare', 'guides',
    'failuresOnly', 'matrixStep', 'matrixCount', 'yaw', 'pitch', 'visible', 'notice'
  ];
  const experimentState = () => Object.fromEntries(experimentKeys.map(key => [key, clone(state[key])]));
  const experiments = {
    intersections: experimentState(),
    dimensions: { ...experimentState(), example: clone(DEFAULTS[3]), selected: [0, 1], visible: Array(DEFAULTS[3].n).fill(true) }
  };
  let activeExperiment = 'intersections';
  function changeExperiment(name) {
    if (name === activeExperiment) return;
    experiments[activeExperiment] = experimentState();
    Object.assign(state, clone(experiments[name]));
    activeExperiment = name; state.drag = null;
  }
  function selectTab(name) {
    if (state.busy) return;
    if (name === 'intersections' || name === 'dimensions') changeExperiment(name);
    state.tab = name; render();
  }
  const marks = ['●', '▲', '■', '◆', '✚', '★', '⬟', '✖'];
  const E = (tag, value, cls) => {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = String(value);
    if (cls) element.className = cls;
    return element;
  };
  const S = (tag, attrs = {}) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    return element;
  };
  const label = (svg, x, y, text, anchor = 'middle', cls = 'grid-label') => {
    const node = S('text', { x, y, 'text-anchor': anchor, class: cls });
    node.textContent = text; svg.append(node);
  };
  const fmtPoint = point => '(' + point.join(',') + ')';
  const fmtEquation = (row, rhs, p) => row.map((a, i) => `${a}x${'₁₂₃₄₅'[i]}`).join(' + ') + ` ≡ ${rhs} (mod ${p})`;
  const effective = () => state.edits ? { ...state.example, A: state.edits.A, c: state.edits.c } : state.example;
  const chosenSystem = () => {
    const example = effective();
    return { ...example, A: state.selected.map(i => example.A[i]), c: state.selected.map(i => example.c[i]) };
  };
  function table(target, headings, rows, responsive = true) {
    const result = E('table', undefined, responsive ? 'responsive-table' : '');
    const head = E('thead'), header = E('tr'), body = E('tbody');
    headings.forEach(value => { const cell = E('th', value); cell.scope = 'col'; header.append(cell); });
    head.append(header);
    rows.forEach(values => {
      const row = E('tr');
      values.forEach((value, i) => { const cell = E('td', value); cell.dataset.label = headings[i]; row.append(cell); });
      body.append(row);
    });
    result.append(head, body); target.replaceChildren(result);
  }
  function graphScale(width, p) {
    const height = width + 40, left = 30, right = width - 15, top = 34, bottom = width - 22;
    const dx = (right - left) / (p - 1), dy = (bottom - top) / (p - 1);
    return { width, height, left, right, top, bottom, dx, dy, X: x => left + x * dx, Y: y => bottom - y * dy };
  }
  function gridMark(index, attributes) {
    const polygon = (count, star = false) => {
      const vertices = Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + i * 2 * Math.PI / count, radius = star && i % 2 ? 2.3 : 5;
        return [Math.cos(angle) * radius, Math.sin(angle) * radius];
      });
      const midpoint = axis => (Math.min(...vertices.map(v => v[axis])) + Math.max(...vertices.map(v => v[axis]))) / 2;
      const cx = midpoint(0), cy = midpoint(1);
      return S('polygon', { points: vertices.map(([x, y]) => (x - cx) + ',' + (y - cy)).join(' '), ...attributes });
    };
    if (index === 1) return polygon(3);
    if (index === 2) return S('rect', { x: -4, y: -4, width: 8, height: 8, ...attributes });
    if (index === 3) return S('polygon', { points: '0,-5 5,0 0,5 -5,0', ...attributes });
    if (index === 4) return S('path', { d: 'M-1.5-5H1.5V-1.5H5V1.5H1.5V5H-1.5V1.5H-5V-1.5H-1.5Z', ...attributes });
    if (index === 5) return polygon(10, true);
    if (index === 6) return polygon(5);
    if (index === 7) return S('path', {
      d: 'M-5-3L-3-5 0-2 3-5 5-3 2 0 5 3 3 5 0 2-3 5-5 3-2 0Z', ...attributes
    });
    return S('circle', { cx: 0, cy: 0, r: 4, ...attributes });
  }
  const gridHoverControllers = new WeakMap();
  function gridTooltip(svg, p, scale, options) {
    gridHoverControllers.get(svg)?.abort();
    const controller = new AbortController(), listener = { signal: controller.signal };
    gridHoverControllers.set(svg, controller);
    const { width, height, left, bottom, dx, dy, X, Y } = scale;
    const axes = options.slice ? ['x₂', 'x₃'] : ['x₁', 'x₂'];
    const popup = S('g', { class: 'grid-tooltip', visibility: 'hidden', 'aria-hidden': 'true', 'data-axes': axes.join(',') });
    const ring = S('circle', { r: 6.5, class: 'grid-hover-ring' });
    const box = S('rect', { rx: 5, height: 52, class: 'grid-tooltip-box' });
    const heading = S('text', { class: 'grid-tooltip-label' }), coordinate = S('text', { class: 'grid-tooltip-label' });
    heading.textContent = t('nearestGridPoint');
    popup.append(ring, box, heading, coordinate); svg.append(popup);
    const hide = () => popup.setAttribute('visibility', 'hidden');
    const show = event => {
      if (event.pointerType === 'touch' || event.buttons) { hide(); return; }
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const clamp = value => Math.max(0, Math.min(p - 1, Math.round(value)));
      const x = clamp((cursor.x - left) / dx), y = clamp((bottom - cursor.y) / dy);
      coordinate.textContent = '(' + axes.join(', ') + ') = (' + x + ', ' + y + ')';
      popup.dataset.coordinate = x + ',' + y;
      ring.setAttribute('cx', X(x)); ring.setAttribute('cy', Y(y));
      const boxWidth = Math.min(width - 16, Math.max(heading.getComputedTextLength(), coordinate.getComputedTextLength()) + 20);
      const bx = Math.max(8, Math.min(width - boxWidth - 8, X(x) + 12));
      const by = Math.max(8, Math.min(height - 60, Y(y) - 62));
      box.setAttribute('x', bx); box.setAttribute('y', by); box.setAttribute('width', boxWidth);
      heading.setAttribute('x', bx + 10); heading.setAttribute('y', by + 20);
      coordinate.setAttribute('x', bx + 10); coordinate.setAttribute('y', by + 40);
      popup.setAttribute('visibility', 'visible');
    };
    svg.addEventListener('pointermove', show, listener);
    svg.addEventListener('pointerleave', hide, listener);
    svg.addEventListener('pointercancel', hide, listener);
    svg.addEventListener('pointerdown', hide, listener);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, listener);
  }
  function foldedGuideSegments(p, equation) {
    const [a, b, c] = equation, limit = p - 1;
    const minimum = Math.min(0, a * limit) + Math.min(0, b * limit);
    const maximum = Math.max(0, a * limit) + Math.max(0, b * limit);
    const segments = [];
    for (let shift = Math.ceil((minimum - c) / p); shift <= Math.floor((maximum - c) / p); shift++) {
      const rhs = c + shift * p, ends = [];
      const add = (x, y) => {
        if (x < -1e-9 || x > limit + 1e-9 || y < -1e-9 || y > limit + 1e-9) return;
        const point = [Math.max(0, Math.min(limit, x)), Math.max(0, Math.min(limit, y))];
        if (!ends.some(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-9)) ends.push(point);
      };
      if (b !== 0) { add(0, rhs / b); add(limit, (rhs - a * limit) / b); }
      if (a !== 0) { add(rhs / a, 0); add((rhs - b * limit) / a, limit); }
      ends.sort((one, two) => one[0] - two[0] || one[1] - two[1]);
      if (ends.length >= 2) segments.push({ rhs, points: [ends[0], ends[ends.length - 1]] });
    }
    return segments;
  }
  function drawRuleStep(svg, scale, step) {
    const [from, to] = step, { X, Y } = scale;
    const direction = Math.sign(Y(to[1]) - Y(from[1]));
    if (!direction) return;
    const startX = X(from[0]) + 4, startY = Y(from[1]) - direction * 3, endX = X(to[0]);
    const tipY = Y(to[1]) - direction * 6, baseY = tipY - direction * 6;
    const group = S('g', {
      class: 'rule-step', 'data-from': JSON.stringify(from), 'data-to': JSON.stringify(to),
      'data-delta': JSON.stringify(to.map((value, i) => value - from[i]))
    });
    group.append(S('line', { x1: startX, y1: startY, x2: endX, y2: startY, class: 'rule-arrow' }),
      S('line', { x1: endX, y1: startY, x2: endX, y2: baseY, class: 'rule-arrow' }),
      S('polygon', { points: `${endX - 3},${baseY} ${endX + 3},${baseY} ${endX},${tipY}`, class: 'rule-arrow' }));
    svg.append(group);
  }
  function graph(svg, p, series, options = {}) {
    const scale = graphScale(Math.min(360, svg.parentElement.clientWidth || 260), p);
    const { width, height, left, right, top, bottom, dx, X, Y } = scale;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.replaceChildren();
    const hover = !!svg.closest('#panel-intersections, #panel-dimensions');
    if (hover) svg.append(S('rect', { x: 0, y: 0, width, height, class: 'grid-pointer-surface' }));
    if (options.candidate !== undefined) {
      svg.append(S('rect', { x: X(options.candidate) - dx / 2, y: top, width: dx, height: bottom - top, class: 'grid-candidate-column' }));
    }
    for (let i = 0; i < p; i++) {
      svg.append(S('line', { x1: X(i), x2: X(i), y1: top, y2: bottom, class: 'grid-line' }),
        S('line', { x1: left, x2: right, y1: Y(i), y2: Y(i), class: 'grid-line' }));
      if (i === 0 || i === p - 1 || i % 4 === 0 || i === options.candidate) label(svg, X(i), bottom + 17, i);
      if (i === 0 || i === p - 1 || i % 4 === 0) label(svg, left - 7, Y(i) + 4, i, 'end');
    }
    label(svg, left, 20, options.axisY || (options.slice ? 'x₃' : t('axisRandom')), 'start', 'grid-axis-label');
    label(svg, width / 2, height - 10, options.axisX || (options.slice ? 'x₂' : t('axisSecret')), 'middle', 'grid-axis-label');
    const points = new Map(), folded = options.foldedLine ? foldedGuideSegments(p, options.foldedLine) : null;
    if (folded) {
      svg.dataset.guideRhs = JSON.stringify(folded.map(segment => segment.rhs));
      svg.dataset.guideSegments = JSON.stringify(folded.map(segment => segment.points));
      if (options.guides) {
        const path = folded.map(({ points: [from, to] }) => `M${X(from[0])},${Y(from[1])} L${X(to[0])},${Y(to[1])}`);
        svg.append(S('path', { d: path.join(' '), class: 'graph-guide' }));
      }
    } else {
      delete svg.dataset.guideRhs; delete svg.dataset.guideSegments;
    }
    for (const item of series) {
      if (options.guides && !folded && item.points.length > 1) {
        const segments = [];
        item.points.forEach((point, i) => {
          const previous = item.points[i - 1];
          const gap = !previous || Math.abs(point[1] - previous[1]) > p / 2;
          segments.push(`${gap ? 'M' : 'L'}${X(point[0])},${Y(point[1])}`);
        });
        svg.append(S('path', { d: segments.join(' '), class: 'graph-guide' }));
      }
      for (const point of item.points) {
        const key = point.join(',');
        if (!points.has(key)) points.set(key, { point, shares: [] });
        points.get(key).shares.push(item.id);
      }
    }
    if (options.realLine) {
      const [a, b, c] = options.realLine, candidates = [];
      if (b !== 0) for (const x of [0, p - 1]) candidates.push([x, (c - a * x) / b]);
      if (a !== 0) for (const y of [0, p - 1]) candidates.push([(c - b * y) / a, y]);
      const ends = candidates.filter(([x, y]) => x >= 0 && x <= p - 1 && y >= 0 && y <= p - 1);
      if (ends.length >= 2) svg.append(S('line', {
        x1: X(ends[0][0]), y1: Y(ends[0][1]), x2: X(ends[1][0]), y2: Y(ends[1][1]), class: 'real-line'
      }));
      svg.dataset.rhs = String(c);
    }
    const ordered = [...points.values()].sort((a, b) => a.point[0] - b.point[0] || a.point[1] - b.point[1]);
    svg.dataset.points = JSON.stringify(ordered.map(item => item.point));
    for (const { point, shares } of ordered) {
      const [x, y] = point, attributes = { 'data-point': point.join(',') };
      const common = !options.common || options.common.some(value => value[0] === x && value[1] === y);
      if (shares.length > 1 && common) {
        svg.append(S('circle', { cx: X(x), cy: Y(y), r: 6, class: 'grid-overlap', ...attributes }),
          S('circle', { cx: X(x), cy: Y(y), r: 3, class: 'grid-overlap' }));
        label(svg, X(x) + 8, Y(y) - 6, shares.length, 'start');
      } else {
        svg.append(gridMark(shares[0], {
          transform: `translate(${X(x)},${Y(y)})`, class: `grid-mark share-${shares[0] + 1}`,
          'data-mark': shares[0], ...attributes
        }));
      }
      if (options.candidate === x || options.all) svg.append(S('circle', { cx: X(x), cy: Y(y), r: 7, class: 'grid-selected' }));
    }
    if (options.secret) {
      const [x, y] = options.secret;
      svg.append(S('circle', { cx: X(x), cy: Y(y), r: 8, class: 'grid-secret' }),
        S('circle', { cx: X(x), cy: Y(y), r: 4, class: 'grid-secret' }));
    }
    if (options.ruleStep) drawRuleStep(svg, scale, options.ruleStep);
    if (hover) gridTooltip(svg, p, scale, options);
  }
  function pointsTable(id, p, series) {
    const rows = series.map(item => [marks[item.id] + ' #' + (item.id + 1), item.points.map(fmtPoint).join(' '),
      Array.from({ length: p }, (_, s) => `${s}:${item.points.filter(point => point[0] === s).length}`).join(' ')]);
    table($(id), [t('chooseShares'), t('point'), t('columns')], rows);
  }
  function optionList(select, values, value) {
    select.replaceChildren(...values.map(item => {
      const option = E('option', item); option.value = String(item); option.selected = String(item) === String(value); return option;
    }));
  }
  function renderIntro(example) {
    const { p, k, n, A, c } = example, line = G.linePoints(A[0], c[0], p);
    $('intro-current-example').textContent = t('introCurrentExample', {
      p, k, n, share: fmtPoint([...A[0], c[0]]), equation: fmtEquation(A[0], c[0], p)
    });
    graph($('intro-grid'), p, [{ id: 0, points: line }]); pointsTable('intro-table', p, [{ id: 0, points: line }]);
    const onePerColumn = Array.from({ length: p }, (_, s) => line.filter(point => point[0] === s).length).every(count => count === 1);
    $('intro-summary').textContent = t(onePerColumn ? 'introColumnsFull' : 'introColumnsOther', { p, max: p - 1 });
    $('intro-summary').dataset.onePerColumn = String(onePerColumn);
    $('intro-column-probability').hidden = !onePerColumn;
    $('edited-real-note').hidden = !state.edits;
  }
  function renderMathPrimer() {
    $('math-guides').checked = state.mathGuides;
    for (const radio of document.querySelectorAll('input[name="math-approach"]')) radio.checked = radio.value === state.mathApproach;
    $('mod-grid').dataset.approach = state.mathApproach;
    $('mod-grid').dataset.guides = String(state.mathGuides);
    if (!$('math-primer').open || !$('panel-intersections').getClientRects().length) {
      for (const id of ['real-grid', 'integer-grid', 'mod-grid']) {
        const svg = $(id);
        gridHoverControllers.get(svg)?.abort(); gridHoverControllers.delete(svg);
        svg.querySelector('.grid-tooltip')?.setAttribute('visibility', 'hidden');
      }
      return;
    }
    const { p, A, c, X } = DEFAULTS[2], a = A[0];
    const line = G.linePoints(a, c[0], p), integerRhs = a[0] * X[0] + a[1] * X[1];
    const integers = [];
    for (let x = 0; x < p; x++) for (let y = 0; y < p; y++) if (a[0] * x + a[1] * y === integerRhs) integers.push([x, y]);
    graph($('real-grid'), p, [], { realLine: [...a, integerRhs], axisX: 'x₁', axisY: 'x₂' });
    graph($('integer-grid'), p, [{ id: 0, points: integers }], { axisX: 'x₁', axisY: 'x₂' });
    const folded = state.mathApproach === 'folded';
    graph($('mod-grid'), p, [{ id: 0, points: line }], {
      guides: state.mathGuides, foldedLine: folded ? [...a, integerRhs] : null,
      ruleStep: (folded ? integers : line).slice(0, 2), axisX: 'x₁', axisY: 'x₂'
    });
    table($('real-table'), [t('equation')], [[`${a[0]}x₁ + ${a[1]}x₂ = ${integerRhs}`]]);
    pointsTable('integer-table', p, [{ id: 0, points: integers }]); pointsTable('mod-table', p, [{ id: 0, points: line }]);
    $('integer-explanation').textContent = t('integerCandidatesText', {
      rhs: integerRhs, points: integers.map(fmtPoint).join(' '), count: integers.length
    });
    $('mod-rule').textContent = t(folded ? 'foldedRule' : 'xOrderRule');
    $('mod-example').textContent = t(folded ? 'foldedExample' : 'xOrderExample');
  }
  function renderPicks(example) {
    $('share-picks').replaceChildren(...example.A.map((_, i) => {
      const button = E('button', `${marks[i]} #${i + 1}`); button.type = 'button'; button.id = 'pick-' + i;
      button.dataset.pick = String(i); button.setAttribute('aria-pressed', String(state.selected.includes(i))); return button;
    }));
    $('legend').replaceChildren(...example.A.map((row, i) =>
      E('span', `${marks[i]} #${i + 1}: ${fmtEquation(row, example.c[i], example.p)}`)));
    $('explore-title').textContent = t(example.k === 2 ? 'explore' : example.k === 3 ? 'exploreK3' : 'exploreHigher', { k: example.k });
    $('selected-summary').textContent = t('selectedCount', { count: state.selected.length, k: example.k });
    const candidateMode = state.selected.length === example.k - 1;
    $('candidate-controls').hidden = !candidateMode || example.k >= 4;
    $('candidate-explanation').hidden = !candidateMode || example.k >= 4;
    $('candidate-all').textContent = t(example.k === 3 ? 'allSlices' : 'allCandidates');
    $('candidate-value').textContent = 's=' + state.candidate;
    $('candidate-all').setAttribute('aria-pressed', String(state.all));
    $('edit-controls').hidden = example.k !== 2;
    const options = state.selected.length ? state.selected : [0];
    if (!options.includes(state.editShare)) state.editShare = options[0];
    optionList($('edit-share'), options.map(i => i + 1), state.editShare + 1);
    for (const id of ['shift-minus', 'shift-plus', 'direction-minus', 'direction-plus']) $(id).disabled = !state.selected.length;
    let warnings = '';
    if (example.k === 2 && state.edits) {
      const row = example.A[state.editShare];
      if (row[1] === 0 && row[0] !== 0) warnings += t('verticalWarning') + ' ';
      if (row.every(value => value === 0)) warnings += t(example.c[state.editShare] === 0 ? 'zeroIdentity' : 'zeroContradiction');
      else for (let i = 0; i < example.n; i++) {
        if (i === state.editShare || example.A[i].every(value => value === 0) || G.rank([row, example.A[i]], example.p) === 2) continue;
        const space = G.solutionSpace([row, example.A[i]], [example.c[state.editShare], example.c[i]], example.p, 2);
        warnings += t(space.consistent ? 'sameLine' : 'parallelDisjoint', { i: i + 1 }) + ' ';
      }
    }
    $('edit-warning').textContent = warnings;
  }
  function renderRecovery(example) {
    const chosen = chosenSystem(), { p, k } = example;
    const counts = G.sCandidates(chosen.A, chosen.c, p, k);
    const count = counts.reduce((sum, value) => sum + value, 0), secrets = counts.filter(Boolean).length;
    let result = t('candidateCountText', { secrets, points: count });
    if (!state.selected.length) result = t('noSelection') + ' ' + result;
    let point = null;
    if (count === 1) {
      point = G.solutionPoints(chosen.A, chosen.c, p, k)[0];
      result = t(state.edits ? 'editedOnePoint' : 'onePoint', { point: point.join(','), s: point[0] });
    }
    if (count === 0) result = t('noSolution');
    $('recovery-result').textContent = result;
    $('recovery-result').dataset.source = state.edits ? 'edited' : 'distributed';
    const explanationKey = !state.selected.length ? 'selectionNone' : !count ? 'selectionNoSolution'
      : point ? 'selectionUnique' : 'selectionPartial';
    let explanation = point && state.edits ? t('selectionEdited') : t(explanationKey, { points: count, p, secrets, s: point?.[0] });
    if (state.selected.length > k) explanation += ' ' + t('selectionExtra', { k });
    if (state.edits && !point) explanation += ' ' + t('selectionEdited') + (!count ? ' ' + t('selectionReset') : '');
    $('selection-explanation').textContent = explanation;
    $('candidate-explanation').textContent = k === 3 ? t('candidateTry3', { s: state.candidate }) : '';
    $('combination-results').replaceChildren();
    if (state.selected.length > k) {
      const recovery = G.reconstruction(chosen.A, chosen.c, p);
      const spaces = recovery.combinations.map(item => G.solutionSpace(item.T.map(i => chosen.A[i]), item.T.map(i => chosen.c[i]), p, k));
      const resultKey = spaces.some(space => space.count > 1) ? 'nonUniqueSubset' : recovery.allAgree ? 'agree' : 'disagree';
      const info = E('p', t(resultKey), 'result'), holder = E('div');
      table(holder, [t('subset'), t('point')], recovery.combinations.map((item, i) => [
        item.T.map(index => '#' + (state.selected[index] + 1)).join(', '), item.X ? fmtPoint(item.X)
          : spaces[i].count ? t('pointCount', { count: spaces[i].count }) : t('noSolution')
      ]));
      $('combination-results').append(info, holder);
    }
    $('k2-interactive').hidden = k !== 2;
    $('candidate-equation').textContent = '';
    $('candidate-inverse-explanation').hidden = true; $('candidate-inverse-explanation').textContent = '';
    if (k === 2) {
      const series = state.selected.map(i => ({ id: i, points: G.linePoints(example.A[i], example.c[i], p) }));
      graph($('main-grid'), p, series, {
        candidate: state.selected.length === 1 ? state.candidate : undefined, all: state.all && state.selected.length === 1,
        secret: point, guides: state.guides
      });
      pointsTable('grid-table', p, series);
      if (state.selected.length === 1) {
        const [a, b] = chosen.A[0], c = chosen.c[0];
        $('candidate-equation').textContent = b ? `x₂ = (${c} − ${a}×${state.candidate})·${G.inv(b, p)} mod ${p} = `
          + G.mod((c - a * state.candidate) * G.inv(b, p), p) : `${a}×s ≡ ${c} (mod ${p}) · ${t('pointCount', { count: counts[state.candidate] })}`;
        if (b) {
          const inverse = G.inv(b, p), x2 = G.mod((c - a * state.candidate) * inverse, p);
          $('candidate-explanation').textContent = t('candidateTry2', { s: state.candidate, x2 });
          $('candidate-inverse-explanation').hidden = false;
          $('candidate-inverse-explanation').textContent = t('candidateInverse', { b, inverse, p });
        } else $('candidate-explanation').textContent = t('candidateColumnCount', { s: state.candidate, count: counts[state.candidate] });
      }
    }
    return { chosen, counts, point };
  }
  function smallSlice(points, p, highlight) {
    const svg = S('svg', { viewBox: '0 0 80 80', 'aria-hidden': 'true' });
    for (let i = 0; i < p; i++) {
      const coordinate = 5 + i * 70 / (p - 1);
      svg.append(S('line', { x1: coordinate, x2: coordinate, y1: 5, y2: 75, class: 'grid-line' }),
        S('line', { x1: 5, x2: 75, y1: coordinate, y2: coordinate, class: 'grid-line' }));
    }
    for (const [y, z] of points) {
      const cx = 5 + y * 70 / (p - 1), cy = 75 - z * 70 / (p - 1);
      if (highlight) svg.append(S('circle', { cx, cy, r: 6, class: 'slice-candidate-ring' }));
      svg.append(S('circle', { cx, cy, r: 4, class: 'slice-overlap' }), S('circle', { cx, cy, r: 2, class: 'slice-dot' }));
    }
    return svg;
  }
  function renderSlices(example, chosen, recoveredPoint) {
    const { p } = example;
    $('slices').replaceChildren(...Array.from({ length: p }, (_, s) => {
      const points = G.slicePoints(chosen.A, chosen.c, p, s), button = E('button');
      button.type = 'button'; button.id = 'slice-' + s; button.dataset.slice = String(s); button.dataset.points = JSON.stringify(points);
      button.setAttribute('aria-pressed', String(state.candidate === s));
      const description = points.length === 1 ? fmtPoint(points[0])
        : t(points.length ? 'pointCount' : 'noPoint', { count: points.length });
      button.append(smallSlice(points, p, state.all || state.candidate === s), E('span', `s=${s} ` + description));
      return button;
    }));
    const points = G.slicePoints(chosen.A, chosen.c, p, state.candidate);
    const series = state.selected.map(i => ({ id: i, points: G.slicePoints([example.A[i]], [example.c[i]], p, state.candidate) }));
    const unique = recoveredPoint !== null;
    graph($('slice-grid'), p, series, { slice: true, common: points, secret: unique && points.length === 1 ? points[0] : null });
    $('slice-grid').dataset.intersections = JSON.stringify(points);
    pointsTable('slice-table', p, series);
    if (!series.length) table($('slice-table'), ['x₂', 'x₃'], points);
    $('slice-explanation').textContent = t('k3SliceReading') + ' ' + t('sliceIntro', { p });
    const elsewhere = unique && recoveredPoint[0] !== state.candidate;
    $('slice-focus-note').hidden = !elsewhere;
    $('slice-focus-note').textContent = elsewhere ? t('sliceRecoveredElsewhere', { s: state.candidate, recovered: recoveredPoint[0] }) : '';
    $('slice-recovered').hidden = !elsewhere;
    $('slice-recovered').textContent = t('goRecoveredSlice', { s: recoveredPoint?.[0] ?? state.candidate });
    $('slice-recovered').dataset.s = String(recoveredPoint?.[0] ?? state.candidate);
    const equations = chosen.A.map((a, i) => `${a[1]}x₂+${a[2]}x₃≡${G.mod(chosen.c[i] - a[0] * state.candidate, p)}`).join('; ');
    $('slice-equation').textContent = equations ? equations + ` (mod ${p})` + (points.length === 1 ? ' → ' + fmtPoint(points[0]) : '') : '';
    $('slice-result').textContent = points.length > 1 ? t('sliceCurrent', { s: state.candidate, count: points.length }) : t('sliceStatus', {
      s: state.candidate, points: points.length ? fmtPoint(points[0]) : t('noPoint'), count: points.length
    });
    $('scene').dataset.yaw = String(state.yaw); $('scene').dataset.pitch = String(state.pitch); $('scene').dataset.slice = String(state.candidate);
    $('camera-description').textContent = t('cameraAngles', { yaw: state.yaw, pitch: state.pitch });
    $('plane-toggles').replaceChildren(...state.selected.map(i => {
      const container = E('label', undefined, 'choice'), input = E('input'); input.type = 'checkbox';
      input.id = 'plane-' + i; input.dataset.plane = String(i); input.checked = state.visible[i];
      container.append(input, E('span', t('planeVisible', { i: i + 1 }))); return container;
    }));
    const sceneRows = state.selected.map(i => [
      '#' + (i + 1), example.A[i].map((a, j) => `${a}x${'₁₂₃'[j]}`).join('+') + '=' + example.A[i].reduce((sum, a, j) => sum + a * example.X[j], 0)
    ]);

    if (typeof renderThreeD === 'function') {
      const real = renderThreeD($('scene'), example, state.selected, state.candidate, state.yaw, state.pitch, state.visible);
      if (real.rank === 3) sceneRows.push(['X', fmtPoint(example.X)]);
      else if (real.realSlice) sceneRows.push(['x₁=' + state.candidate, fmtPoint(real.realSlice.map(x => Number(x.toFixed(3))))]);
      table($('scene-table'), [t('chooseShares'), t('equation')], sceneRows);
      $('real-slice-value').textContent = real.realSlice
        ? t('realSlice', { point: real.realSlice.map(x => Number(x.toFixed(3))).join(',') }) + (real.outside ? ' · ' + t('outsideBox') : '')
        : t(real.sliceConsistent ? 'realUndetermined' : 'realNoPoint');
    }
  }
  function matrixTable(target, matrix, k) {
    const grid = E('table'), head = E('thead'), hr = E('tr'), body = E('tbody');
    ['R', ...Array.from({ length: k }, (_, i) => 'x' + (i + 1)), 'c'].forEach(text => hr.append(E('th', text)));
    head.append(hr);
    matrix.forEach((values, i) => {
      const row = E('tr'); row.append(E('th', 'R' + (i + 1))); values.forEach(value => row.append(E('td', value))); body.append(row);
    });
    grid.append(head, body); target.replaceChildren(grid);
  }
  function operation(op, p) {
    if (op === 'start') return t('matrixStart');
    let match = op.match(/^R(\d+)<->R(\d+)$/);
    if (match) return t('matrixSwap', { a: match[1], b: match[2] });
    match = op.match(/^R(\d+)<-R\d+\*(\d+)$/);
    if (match) return t('matrixScale', { a: match[1], f: match[2], inverse: G.inv(Number(match[2]), p), p });
    match = op.match(/^R(\d+)<-R\d+-(\d+)\*R(\d+)$/);
    return match ? t('matrixSubtract', { a: match[1], f: match[2], b: match[3] }) : op;
  }
  function renderMatrix(example, chosen) {
    const { p, k } = example, rows = chosen.A.slice(0, k), rhs = chosen.c.slice(0, k);
    let intro = t('matrixIntro', { k, p });
    if (chosen.A.length > rows.length) intro += ' ' + t('matrixScope', { used: rows.length, total: chosen.A.length });
    $('matrix-intro').dataset.used = String(rows.length); $('matrix-intro').dataset.selected = String(chosen.A.length);
    const steps = rows.length ? G.gaussJordanSteps(rows, rhs, p) : [{ op: 'start', m: [] }];
    state.matrixStep = Math.max(0, Math.min(state.matrixStep, steps.length - 1));
    state.matrixCount = steps.length;
    const step = steps[state.matrixStep];
    if (step.m.length) intro += ' ' + t('matrixMeaning', { equation: fmtEquation(step.m[0].slice(0, k), step.m[0][k], p) });
    $('matrix-intro').textContent = intro;
    $('matrix-op').textContent = operation(step.op, p); $('matrix-step').textContent = `${state.matrixStep + 1}/${steps.length}`;
    matrixTable($('matrix-table'), step.m, k); $('matrix-prev').disabled = state.matrixStep === 0;
    $('matrix-next').disabled = state.matrixStep === steps.length - 1;
    let explanation = t('matrixInProgress');
    if (!rows.length) explanation = t('matrixEmpty');
    else if (state.matrixStep === steps.length - 1) {
      const counts = G.sCandidates(rows, rhs, p, k), count = counts.reduce((sum, value) => sum + value, 0);
      if (count === 1) {
        const point = G.solutionPoints(rows, rhs, p, k)[0];
        explanation = t('matrixUnique', { point: fmtPoint(point), s: point[0] });
      } else explanation = count ? t('matrixRemaining', { secrets: counts.filter(Boolean).length, points: count }) : t('matrixNoSolution');
    }
    $('matrix-explanation').textContent = explanation;
    $('matrix-all').replaceChildren(...steps.map(item => {
      const section = E('section', undefined, 'matrix-all-step matrix-frame'); section.append(E('h4', operation(item.op, p)));
      const holder = E('div'); matrixTable(holder, item.m, k); section.append(holder); return section;
    }));
    $('matrix-candidates').replaceChildren();
    if (state.selected.length === k - 1) {
      const holder = E('div'); table(holder, ['s', t('point')], G.solutionPoints(rows, rhs, p, k).map(point => [point[0], fmtPoint(point)]));
      $('matrix-candidates').append(E('p', t('freeVariable')), holder);
    }
  }
  function renderDealer(example) {
    const { p, k, n, X, A, c } = state.example;
    $('prime').value = String(p); optionList($('share-count'), Array.from({ length: Math.min(8, p - 1) - k + 1 }, (_, i) => k + i), n);
    $('secret').max = String(p - 1); $('secret').value = String(X[0]); $('method').value = state.method;
    if ($('coordinates').children.length !== k - 1) {
      $('coordinates').replaceChildren(...X.slice(1).map((_, index) => {
        const container = E('label'), input = E('input'); input.id = 'coordinate-' + (index + 1);
        input.type = 'number'; input.dataset.coordinate = String(index + 1);
        container.append(E('span', 'x' + '₂₃₄₅'[index]), input); return container;
      }));
    }
    X.slice(1).forEach((value, index) => {
      const input = $('coordinate-' + (index + 1));
      input.min = '0'; input.max = String(p - 1);
      if (input.value !== String(value)) input.value = String(value);
    });
    $('example-kind').textContent = t(state.kind === 'fixed' ? 'fixedExample' : state.kind === 'manual' ? 'manualExample' : 'randomExample');
    $('manual-note').hidden = state.kind !== 'manual';
    table($('distribution-table'), [t('shareRecipient'), t('distributedShare'), t('equation')], A.map((row, i) => [
      t('custodian', { i: i + 1 }), '(' + [...row, c[i]].join(',') + ')',
      row.map((a, j) => `${a}x${'₁₂₃₄₅'[j]}`).join('+') + ` ≡ ${c[i]} (mod ${p})`
    ]));
    const checks = G.checkRows(example.A, p), first = checks.filter(row => row.kind === 'i'), second = checks.filter(row => row.kind === 'ii');
    $('inspection-summary').textContent = t('checkSummary', {
      ki: k, kii: k - 1, passI: first.filter(row => row.ok).length, totalI: first.length,
      passII: second.filter(row => row.ok).length, totalII: second.length,
      markI: first.every(row => row.ok) ? '✓' : '✗', markII: second.every(row => row.ok) ? '✓' : '✗'
    });
    const show = checks.filter(row => !state.failuresOnly || !row.ok).sort((a, b) => Number(a.ok) - Number(b.ok));
    table($('inspection-list'), [t('subset'), t('criterion'), t('judgment')], show.map(row => [
      `{${row.T.map(i => i + 1).join(',')}}`, row.kind === 'i' ? t('checkI') : t('checkII'), t(row.ok ? 'pass' : 'fail')
    ]));
    $('inspection-list').dataset.failed = String(checks.filter(row => !row.ok).length);
    const notice = state.notice ? [state.notice, ...(state.notice.adjustments || [])] : [];
    $('status').textContent = state.busy ? t('working') : notice.map(item => t(item.key, item.values)).join(' ');
  }
  function renderIntersections() {
    const example = effective();
    $('threshold-summary').textContent = t('thresholdSummary', { p: example.p, k: example.k, n: example.n });
    $('dimensions-current').textContent = t('dimensionsCurrent', { p: example.p, k: example.k, n: example.n });
    $('dimension-stage').hidden = example.k === 2;
    $('dimension-title').hidden = example.k === 2; $('dimension-intro').hidden = example.k === 2;
    $('dimension-title').textContent = t(example.k >= 4 ? 'dimensionTitleHigher' : 'nextDimension', { k: example.k });
    $('dimension-intro').textContent = t(example.k === 2 ? 'dimensionIntroK2' : example.k === 3 ? 'dimensionIntroK3' : 'dimensionIntroHigher', {
      k: example.k, p: example.p, n: example.n
    });
    renderMathPrimer();
    $('k2-view').hidden = example.k !== 2;
    if (example.k === 2) renderIntro(state.example);
    renderPicks(example);
    const { chosen, point } = renderRecovery(example);
    $('view-3d').hidden = example.k !== 3; $('matrix-view').hidden = example.k < 4;
    if (example.k === 3) renderSlices(example, chosen, point);
    if (example.k >= 4) renderMatrix(example, chosen);
    renderDealer(example);
    if (state.busy) document.querySelectorAll('main button, main input, main select').forEach(el => { el.disabled = true; });
  }
  function restore() {
    const k = activeExperiment === 'intersections' ? 2 : 3;
    const target = k === 2 ? 'intersections' : 'dimensions';
    changeExperiment(target); state.tab = target;
    state.example = clone(DEFAULTS[k]); state.edits = null; state.kind = 'fixed';
    state.selected = Array.from({ length: k - 1 }, (_, i) => i); state.candidate = 0; state.all = false;
    state.editShare = 0; state.matrixStep = 0; state.visible = Array(state.example.n).fill(true); state.yaw = 35; state.pitch = 25;
    state.notice = { key: 'primeChanged', values: { k, p: state.example.p } }; render();
  }
  let generationInteraction = 0, generationFocusIntent = null;
  const randomBytes = count => crypto.getRandomValues(new Uint8Array(count));
  async function regenerate(changes = {}, source = null) {
    if (state.busy) return;
    const focus = generationFocusIntent?.source === source ? generationFocusIntent : null;
    generationFocusIntent = null;
    const original = state.example, p = changes.p || original.p, k = original.k;
    const n = Math.min(changes.n || original.n, p - 1), secret = Math.min(changes.secret ?? original.X[0], p - 1);
    state.busy = true; state.notice = null; render(); await new Promise(resolve => setTimeout(resolve, 0));
    try {
      let normals;
      if (state.method === 'vandermonde') normals = { A: G.vandermonde(p, k, n), attempts: 0 };
      else {
        for (const trial of G.sequentialNormalAttempts(p, k, n, randomBytes)) {
          normals = trial;
          if (k >= 4) await new Promise(resolve => setTimeout(resolve, 0));
          if (trial.A) break;
        }
      }
      if (!normals || !normals.A) throw new Error('generation failed');
      state.example = G.completeShares(p, k, n, secret, normals.A, randomBytes, normals.attempts);
      state.edits = null; state.kind = 'random'; state.selected = Array.from({ length: k - 1 }, (_, i) => i);
      state.candidate = 0; state.matrixStep = 0; state.visible = Array(n).fill(true); state.all = false;
      const adjustments = [];
      if (p !== original.p && secret !== original.X[0]) {
        adjustments.push({ key: 'adjustedSecret', values: { p, before: original.X[0], after: secret, max: p - 1 } });
      }
      if (p !== original.p && n !== original.n) {
        adjustments.push({ key: 'adjustedShareCount', values: { p, before: original.n, after: n } });
      }
      state.notice = { key: 'generated', values: { attempts: normals.attempts }, adjustments };
    } catch (_) { state.notice = { key: 'generationFailed', values: {} }; }
    finally {
      state.busy = false; document.querySelectorAll('main button, main input, main select').forEach(el => { el.disabled = false; }); render();
      if (focus && focus.interaction === generationInteraction && focus.target?.isConnected
          && visibleFocusTarget(focus.target)) focus.target.focus({ preventScroll: true });
    }
  }
  function modify(component, delta) {
    if (!state.selected.length) return;
    if (!state.edits) state.edits = { A: clone(state.example.A), c: state.example.c.slice() };
    const i = state.editShare, p = state.example.p;
    if (component === 'c') state.edits.c[i] = G.mod(state.edits.c[i] + delta, p);
    else state.edits.A[i][1] = G.mod(state.edits.A[i][1] + delta, p);
    render();
  }
  function rotate(yaw, pitch) {
    state.yaw = Math.round((state.yaw + yaw + 360) % 360); state.pitch = Math.max(-80, Math.min(80, state.pitch + pitch)); render();
  }
  function bindIntersections() {
    document.addEventListener('pointerdown', () => { generationInteraction++; generationFocusIntent = null; }, true);
    document.addEventListener('keydown', event => {
      generationInteraction++; generationFocusIntent = null;
      if (!event.target.matches('#secret, #prime, #share-count, #method, #generate')) return;
      let target = event.target;
      if (event.key === 'Tab') {
        const available = [...document.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')]
          .filter(el => el.tabIndex >= 0 && visibleFocusTarget(el));
        const index = available.indexOf(target), delta = event.shiftKey ? -1 : 1;
        target = available[index + delta] || null;
      }
      generationFocusIntent = { source: event.target, target, interaction: generationInteraction };
    }, true);
    $('share-picks').addEventListener('click', event => {
      const target = event.target.closest('[data-pick]'); if (!target) return;
      const i = Number(target.dataset.pick);
      state.selected = state.selected.includes(i) ? state.selected.filter(value => value !== i) : [...state.selected, i].sort((a, b) => a - b);
      state.matrixStep = 0; render();
    });
    $('candidate-prev').addEventListener('click', () => { state.candidate = G.mod(state.candidate - 1, state.example.p); render(); });
    $('candidate-next').addEventListener('click', () => { state.candidate = G.mod(state.candidate + 1, state.example.p); render(); });
    $('candidate-all').addEventListener('click', () => { state.all = !state.all; render(); });
    $('guides').addEventListener('change', event => { state.guides = event.target.checked; render(); });
    $('math-guides').addEventListener('change', event => { state.mathGuides = event.target.checked; renderMathPrimer(); });
    for (const radio of document.querySelectorAll('input[name="math-approach"]')) radio.addEventListener('change', () => {
      if (!radio.checked || !['folded', 'x-order'].includes(radio.value)) return;
      state.mathApproach = radio.value; renderMathPrimer();
    });
    $('math-primer').addEventListener('toggle', renderMathPrimer);
    $('edit-share').addEventListener('change', event => { state.editShare = Number(event.target.value) - 1; render(); });
    for (const [id, component, delta] of [['shift-minus', 'c', -1], ['shift-plus', 'c', 1], ['direction-minus', 'b', -1], ['direction-plus', 'b', 1]]) {
      $(id).addEventListener('click', () => modify(component, delta));
    }
    $('edit-actions').addEventListener('keydown', event => {
      const action = { ArrowUp: ['c', 1], ArrowDown: ['c', -1], ArrowLeft: ['b', -1], ArrowRight: ['b', 1] }[event.key];
      if (action) { event.preventDefault(); modify(...action); }
    });
    $('reset-edit').addEventListener('click', () => { state.edits = null; render(); });
    $('reset-default').addEventListener('click', restore);
    $('prime').addEventListener('change', event => regenerate({ p: Number(event.target.value) }, event.target));
    $('share-count').addEventListener('change', event => regenerate({ n: Number(event.target.value) }, event.target));
    $('method').addEventListener('change', event => { state.method = event.target.value; regenerate({}, event.target); });
    $('generate').addEventListener('click', event => regenerate({}, event.target));
    $('secret').addEventListener('change', event => {
      const value = Number(event.target.value);
      if (!event.target.value || !Number.isInteger(value) || value < 0 || value >= state.example.p) {
        state.notice = { key: 'invalidCoordinate', values: { max: state.example.p - 1 } }; render(); return;
      }
      regenerate({ secret: value }, event.target);
    });
    $('coordinates').addEventListener('change', event => {
      const index = Number(event.target.dataset.coordinate), value = Number(event.target.value);
      if (!index) return;
      if (!event.target.value || !Number.isInteger(value) || value < 0 || value >= state.example.p) {
        state.notice = { key: 'invalidCoordinate', values: { max: state.example.p - 1 } }; render(); return;
      }
      state.example.X[index] = value; state.example.c = state.example.A.map(row => G.dot(row, state.example.X, state.example.p));
      state.kind = 'manual'; state.edits = null; state.notice = null; render();
    });
    $('failures-only').addEventListener('change', event => { state.failuresOnly = event.target.checked; render(); });
    $('slices').addEventListener('click', event => {
      const button = event.target.closest('[data-slice]'); if (button) { state.candidate = Number(button.dataset.slice); render(); }
    });
    $('slice-recovered').addEventListener('click', () => {
      state.candidate = Number($('slice-recovered').dataset.s); render();
      $('slice-' + state.candidate).focus({ preventScroll: true });
    });
    $('plane-toggles').addEventListener('change', event => { state.visible[Number(event.target.dataset.plane)] = event.target.checked; render(); });
    for (const [id, yaw, pitch] of [['yaw-left', -10, 0], ['yaw-right', 10, 0], ['pitch-up', 0, 10], ['pitch-down', 0, -10]]) {
      $(id).addEventListener('click', () => rotate(yaw, pitch));
    }
    $('camera-reset').addEventListener('click', () => { state.yaw = 35; state.pitch = 25; render(); });
    $('scene').addEventListener('keydown', event => {
      const action = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[event.key];
      if (action) { event.preventDefault(); rotate(...action); }
    });
    $('scene').addEventListener('pointerdown', event => { state.drag = { x: event.clientX, yaw: state.yaw }; $('scene').setPointerCapture(event.pointerId); });
    $('scene').addEventListener('pointermove', event => {
      if (!state.drag) return; state.yaw = Math.round((state.drag.yaw + (event.clientX - state.drag.x) * .5 + 720) % 360); render();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('scene').addEventListener(name, () => { state.drag = null; });
    $('matrix-prev').addEventListener('click', () => { state.matrixStep--; render(); });
    $('matrix-next').addEventListener('click', () => { state.matrixStep++; render(); });
    window.addEventListener('resize', () => render());
  }

  const threeDEpsilon = 1e-8;
  let threeDSequence = 0;
  const threeDIds = new WeakMap();
  const threeDDot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const threeDSubtract = (a, b) => a.map((value, i) => value - b[i]);
  const threeDCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  function threeDCube(limit) {
    const vertices = Array.from({ length: 8 }, (_, index) => [index & 1, (index >> 1) & 1, (index >> 2) & 1].map(v => v * limit));
    const edges = [];
    for (let index = 0; index < 8; index++) {
      for (let axis = 0; axis < 3; axis++) {
        const next = index ^ (1 << axis);
        if (index < next) edges.push({ a: vertices[index], b: vertices[next], axis });
      }
    }
    return { vertices, edges };
  }

  function threeDPlanePolygon(normal, rhs, limit) {
    const points = [];
    const tolerance = threeDEpsilon * Math.max(1, limit);
    function add(point) {
      if (!points.some(other => Math.hypot(...threeDSubtract(point, other)) < tolerance)) points.push(point);
    }
    for (const edge of threeDCube(limit).edges) {
      const left = threeDDot(normal, edge.a) - rhs;
      const right = threeDDot(normal, edge.b) - rhs;
      if (Math.abs(left) < tolerance) add(edge.a.slice());
      if (Math.abs(right) < tolerance) add(edge.b.slice());
      if (left * right < 0) {
        const ratio = left / (left - right);
        add(edge.a.map((value, i) => value + ratio * (edge.b[i] - value)));
      }
    }
    if (points.length < 3) return points;
    const center = [0, 1, 2].map(i => points.reduce((sum, point) => sum + point[i], 0) / points.length);
    const reference = [0, 0, 0];
    const least = normal.reduce((best, value, i) => Math.abs(value) < Math.abs(normal[best]) ? i : best, 0);
    reference[least] = 1;
    const first = threeDCross(normal, reference);
    const length = Math.hypot(...first);
    if (length < threeDEpsilon) return [];
    const u = first.map(value => value / length);
    const v = threeDCross(normal, u);
    const vLength = Math.hypot(...v);
    const unitV = v.map(value => value / vLength);
    const angle = point => {
      const delta = threeDSubtract(point, center);
      return Math.atan2(threeDDot(delta, unitV), threeDDot(delta, u));
    };
    return points.sort((a, b) => angle(a) - angle(b));
  }

  function threeDRealSystem(A, rhs, columns) {
    const rows = A.map((row, i) => [...row, rhs[i]]);
    const pivots = [];
    let rank = 0;
    for (let column = 0; column < columns && rank < rows.length; column++) {
      let pivot = rank;
      for (let row = rank + 1; row < rows.length; row++) {
        if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
      }
      if (Math.abs(rows[pivot][column]) < threeDEpsilon) continue;
      [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
      const divisor = rows[rank][column];
      rows[rank] = rows[rank].map(value => value / divisor);
      for (let row = 0; row < rows.length; row++) {
        if (row === rank) continue;
        const factor = rows[row][column];
        rows[row] = rows[row].map((value, i) => value - factor * rows[rank][i]);
      }
      pivots.push(column);
      rank++;
    }
    const consistent = !rows.some(row => row.slice(0, columns).every(value => Math.abs(value) < threeDEpsilon)
      && Math.abs(row[columns]) >= threeDEpsilon);
    const base = new Array(columns).fill(0);
    pivots.forEach((column, i) => { base[column] = rows[i][columns]; });
    const free = Array.from({ length: columns }, (_, i) => i).filter(i => !pivots.includes(i));
    const basis = free.map(column => {
      const vector = new Array(columns).fill(0);
      vector[column] = 1;
      pivots.forEach((pivot, i) => { vector[pivot] = -rows[i][column]; });
      return vector;
    });
    return { rank, consistent, base: consistent ? base : null, basis };
  }

  function threeDClipLine(point, vector, limit) {
    let low = -Infinity;
    let high = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(vector[axis]) < threeDEpsilon) {
        if (point[axis] < -threeDEpsilon || point[axis] > limit + threeDEpsilon) return null;
      } else {
        const first = -point[axis] / vector[axis];
        const second = (limit - point[axis]) / vector[axis];
        low = Math.max(low, Math.min(first, second));
        high = Math.min(high, Math.max(first, second));
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high + threeDEpsilon) return null;
    return [low, high].map(value => point.map((coordinate, i) => Math.max(0, Math.min(limit, coordinate + value * vector[i]))));
  }

  function threeDProject(point, limit, yaw, pitch) {
    const yawRadians = yaw * Math.PI / 180;
    const pitchRadians = pitch * Math.PI / 180;
    const [x, y, z] = point.map(value => value - limit / 2);
    const horizontal = Math.cos(yawRadians) * x - Math.sin(yawRadians) * y;
    const rotatedY = Math.sin(yawRadians) * x + Math.cos(yawRadians) * y;
    const vertical = Math.sin(pitchRadians) * rotatedY - Math.cos(pitchRadians) * z;
    const depth = Math.cos(pitchRadians) * rotatedY + Math.sin(pitchRadians) * z;
    const scale = 270 / (Math.sqrt(3) * limit);
    return { x: 180 + horizontal * scale, y: 180 + vertical * scale, depth };
  }

  function threeDFrontEdge(edge, limit, yaw, pitch) {
    const yawRadians = yaw * Math.PI / 180;
    const pitchRadians = pitch * Math.PI / 180;
    const camera = [
      Math.cos(pitchRadians) * Math.sin(yawRadians),
      Math.cos(pitchRadians) * Math.cos(yawRadians),
      Math.sin(pitchRadians)
    ];
    return camera.some((component, axis) => axis !== edge.axis
      && component * (edge.a[axis] === limit ? 1 : -1) > threeDEpsilon);
  }

  function threeDLine(group, a, b, project, className) {
    const start = project(a);
    const end = project(b);
    group.append(S('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: className }));
  }

  function threeDHatches(defs, prefix) {
    for (let index = 0; index < 8; index++) {
      const angle = [30, -30, 0, 90, 45, 0, 60, 0][index];
      const pattern = S('pattern', {
        id: prefix + '-hatch-' + index, width: 9, height: 9, patternUnits: 'userSpaceOnUse',
        patternTransform: 'rotate(' + angle + ')'
      });
      if (index === 5) {
        pattern.append(S('circle', { cx: 4.5, cy: 4.5, r: 1.2, class: 'three-hatch-dot' }));
      } else {
        const shape = index === 4 ? 'M0 0H9M0 0V9'
          : index === 6 ? 'M0 1H9M0 4H9' : index === 7 ? 'M1 4.5H8M4.5 1V8' : 'M0 0H9';
        pattern.append(S('path', { d: shape, class: 'three-hatch' }));
      }
      defs.append(pattern);
    }
  }

  function threeDAxisLabels(svg, limit, project) {
    const positions = [0, 1, 2].map(axis => {
      const point = [0, 0, 0];
      point[axis] = limit;
      const screen = project(point);
      const distance = Math.hypot(screen.x - 180, screen.y - 180) || 1;
      return {
        x: Math.max(28, Math.min(332, screen.x + (screen.x - 180) / distance * 19)),
        y: Math.max(42, Math.min(326, screen.y + (screen.y - 180) / distance * 19))
      };
    });
    for (let repeat = 0; repeat < 8; repeat++) {
      for (let a = 0; a < positions.length; a++) {
        for (let b = a + 1; b < positions.length; b++) {
          const left = positions[a];
          const right = positions[b];
          if (Math.abs(left.x - right.x) < 44 && Math.abs(left.y - right.y) < 30) {
            const shift = (44 - Math.abs(left.x - right.x)) / 2 + 1;
            left.x = Math.max(25, left.x - shift);
            right.x = Math.min(335, right.x + shift);
          }
        }
      }
    }
    const group = S('g', { class: 'three-axis-labels', 'data-layer': 'axis-labels' });
    positions.forEach((position, axis) => {
      group.append(S('rect', { x: position.x - 21, y: position.y - 15, width: 42, height: 28, rx: 4, class: 'three-label-paper' }));
      const label = S('text', { x: position.x, y: position.y + 6, 'text-anchor': 'middle', class: 'three-axis-label' });
      label.textContent = ['x₁', 'x₂', 'x₃'][axis];
      group.append(label);
    });
    svg.append(group);
  }

  function renderThreeD(svg, example, selected, candidate, yaw, pitch, visible) {
    if (example.k !== 3) throw new RangeError('3D rendering requires k=3');
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new TypeError('camera angles must be finite');
    const limit = example.p - 1;
    if (!Number.isInteger(candidate) || candidate < 0 || candidate > limit) throw new RangeError('invalid slice');
    const normal = example.A.map(row => row.map(value => ((value % example.p) + example.p) % example.p));
    const integerRhs = normal.map(row => threeDDot(row, example.X));
    const indices = [...new Set(selected)].sort((a, b) => a - b);
    const rows = indices.map(index => normal[index]);
    const rhs = indices.map(index => integerRhs[index]);
    const space = threeDRealSystem(rows, rhs, 3);
    const slice = threeDRealSystem(rows.map(row => row.slice(1)), rows.map((row, i) => rhs[i] - row[0] * candidate), 2);
    const realSlice = slice.consistent && slice.rank === 2 ? slice.base : null;
    const outside = realSlice !== null && realSlice.some(value => value < -threeDEpsilon || value > limit + threeDEpsilon);
    const project = point => threeDProject(point, limit, yaw, pitch);
    const cube = threeDCube(limit);
    if (!threeDIds.has(svg)) threeDIds.set(svg, 'blakley-three-' + (++threeDSequence));
    const prefix = threeDIds.get(svg);
    svg.replaceChildren();
    svg.setAttribute('viewBox', '0 0 360 360');
    svg.classList.add('three-d');
    const title = S('title', {});
    title.textContent = t('threeFigureTitle');
    const description = S('desc', {});
    description.textContent = t('threeFigureDescription');
    const defs = S('defs', {});
    threeDHatches(defs, prefix);
    svg.append(title, description, defs, S('rect', { x: 0, y: 0, width: 360, height: 360, class: 'three-background' }));
    const back = S('g', { 'data-layer': 'back-edges' });
    const front = S('g', { 'data-layer': 'front-edges' });
    for (const edge of cube.edges) {
      const isFront = threeDFrontEdge(edge, limit, yaw, pitch);
      threeDLine(isFront ? front : back, edge.a, edge.b, project, isFront ? 'three-box-front' : 'three-box-back');
    }
    svg.append(back);
    const planes = S('g', { 'data-layer': 'planes' });
    for (const index of indices) {
      if (visible && visible[index] === false) continue;
      const polygon = threeDPlanePolygon(normal[index], integerRhs[index], limit);
      const group = S('g', { class: 'three-plane share-' + (index + 1), 'data-share': index + 1 });
      if (polygon.length >= 3) {
        const points = polygon.map(point => {
          const screen = project(point);
          return screen.x + ',' + screen.y;
        }).join(' ');
        group.append(S('polygon', { points, class: 'three-plane-paper' }));
        group.append(S('polygon', { points, fill: 'url(#' + prefix + '-hatch-' + index + ')', class: 'three-plane-hatched' }));
      } else if (polygon.length === 2) {
        threeDLine(group, polygon[0], polygon[1], project, 'three-plane-edge');
      } else if (polygon.length === 1) {
        const screen = project(polygon[0]);
        group.append(S('circle', { cx: screen.x, cy: screen.y, r: 3, class: 'three-plane-corner' }));
      }
      planes.append(group);
    }
    const boardPoints = [[candidate, 0, 0], [candidate, limit, 0], [candidate, limit, limit], [candidate, 0, limit]];
    const board = boardPoints.map(point => {
      const screen = project(point);
      return screen.x + ',' + screen.y;
    }).join(' ');
    planes.append(S('polygon', { points: board, class: 'three-slice-board', 'data-slice': candidate }));
    svg.append(planes);
    const intersection = S('g', { 'data-layer': 'intersection-line' });
    if (indices.length >= 2 && space.consistent && space.rank === 2) {
      const segment = threeDClipLine(space.base, space.basis[0], limit);
      if (segment) threeDLine(intersection, segment[0], segment[1], project, 'three-intersection-line');
    }
    svg.append(intersection);
    const points = S('g', { 'data-layer': 'intersection-points' });
    if (realSlice && !outside && space.rank === 2) {
      const screen = project([candidate, ...realSlice]);
      points.append(S('circle', { cx: screen.x, cy: screen.y, r: 6, class: 'three-real-slice-ring' }));
      points.append(S('circle', { cx: screen.x, cy: screen.y, r: 2, class: 'three-real-slice-dot' }));
    }
    if (indices.length >= 3 && space.consistent && space.rank === 3) {
      const screen = project(space.base);
      points.append(S('circle', { cx: screen.x, cy: screen.y, r: 8, class: 'three-secret-ring' }));
      points.append(S('circle', { cx: screen.x, cy: screen.y, r: 3, class: 'three-secret-dot' }));
    }
    svg.append(points, front);
    threeDAxisLabels(svg, limit, project);
    const boardLabel = S('text', { x: 180, y: 25, 'text-anchor': 'middle', class: 'three-slice-label' });
    boardLabel.textContent = t('threeSliceLabel', { s: candidate });
    svg.append(boardLabel);
    return { realSlice, outside, rank: space.rank, sliceConsistent: slice.consistent };
  }

  const PITFIX = {
  "leak_k2": {
    "p": 13,
    "A": [
      [
        4,
        0
      ]
    ],
    "c": [
      7
    ],
    "sCandidates": [
      0,
      0,
      0,
      0,
      0,
      13,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ]
  },
  "leak_k3": {
    "p": 11,
    "A": [
      [
        1,
        2,
        3
      ],
      [
        5,
        4,
        6
      ]
    ],
    "c": [
      5,
      9
    ],
    "sCandidates": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      11,
      0,
      0,
      0
    ],
    "sliceCounts": [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      11,
      0,
      0,
      0
    ],
    "checkBadII": [
      [
        0,
        1
      ]
    ]
  },
  "parallel_k2": {
    "p": 13,
    "A": [
      [
        1,
        3
      ],
      [
        6,
        5
      ]
    ],
    "c": [
      3,
      5
    ],
    "rank": 1,
    "sCandidates": [
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1
    ],
    "badI": [
      [
        0,
        1
      ]
    ]
  }
};
  function pitModel(mode) {
    const reference = PITFIX[mode === 'vertical' ? 'leak_k2' : mode === 'leak3' ? 'leak_k3' : 'parallel_k2'];
    const X = mode === 'leak3' ? DEFAULTS[3].X : DEFAULTS[2].X;
    const values = [...reference.A.flat(), ...X.slice(1)]; let position = 0;
    return P.uncheckedShares(reference.p, X.length, reference.A.length, X[0],
      count => Uint8Array.from({ length: count }, () => values[position++]));
  }
  function renderPitB() {
    const example = DEFAULTS[state.pitBK], { p, k, A, c } = example, count = state.pitBCount;
    $('pit-b-k2').setAttribute('aria-pressed', String(k === 2)); $('pit-b-k3').setAttribute('aria-pressed', String(k === 3));
    $('pit-b-picks').replaceChildren(...Array.from({ length: k + 1 }, (_, i) => {
      const button = E('button', t('pitShareCount', { count: i })); button.type = 'button';
      button.id = 'pit-b-count-' + i; button.dataset.bCount = String(i); button.setAttribute('aria-pressed', String(i === count)); return button;
    }));
    const rows = Array.from({ length: k + 1 }, (_, i) => [i, P.pointCandidates(A, c, p, i),
      G.sCandidates(A.slice(0, i), c.slice(0, i), p, k).filter(Boolean).length]);
    const whole = count ? P.restoreWholePoint(A.slice(0, count), c.slice(0, count), p) : { count: p ** k, point: null };
    $('pit-b-input').textContent = `GF(${p}), k=${k}, ` + t('pitShareCount', { count });
    $('pit-b-unsafe').textContent = t('pitWholeResult', { count: whole.count }) + (whole.point ? ' X=' + fmtPoint(whole.point) : '');
    $('pit-b-result').textContent = t('pitCoordinateResult', { count: rows[count][2] });
    table($('pit-b-table'), [t('pitShares'), t('pitWhole'), t('pitFirst')], rows);
    $('pit-b-grid').toggleAttribute('hidden', k !== 2); $('pit-b-slices').hidden = k !== 3;
    for (const id of ['pit-b-k3-count-reading', 'pit-b-slice-reading', 'pit-b-slice-status']) $(id).hidden = k !== 3;
    $('pit-b-slice-status').textContent = t('pitBSliceStatus', { points: whole.count, p, secrets: rows[count][2] });
    if (k === 2) {
      const points = G.solutionPoints(A.slice(0, count), c.slice(0, count), p, k);
      graph($('pit-b-grid'), p, [{ id: 0, points }], { secret: whole.point });
      table($('pit-b-points'), ['s', 'x₂'], points);
    } else {
      table($('pit-b-points'), ['s', t('point')], Array.from({ length: p }, (_, s) => [s,
        G.slicePoints(A.slice(0, count), c.slice(0, count), p, s).map(fmtPoint).join(' ') || t('noPoint')]));
      $('pit-b-slices').replaceChildren(...Array.from({ length: p }, (_, s) => {
        const points = G.slicePoints(A.slice(0, count), c.slice(0, count), p, s), figure = E('figure');
        figure.dataset.s = String(s); figure.dataset.count = String(points.length);
        figure.append(smallSlice(points, p, false), E('figcaption', `s=${s}: ` + t('pointCount', { count: points.length }))); return figure;
      }));
    }
  }
  function renderPitC() {
    const D = DEFAULTS[2], p = D.p, narrow = state.pitCMode === 'narrow', index = narrow ? 0 : state.pitCShare;
    $('pit-c-mode').value = state.pitCMode; $('pit-c-share').value = String(state.pitCShare); $('pit-c-share-wrap').hidden = narrow;
    const made = narrow ? P.narrowShares(D.A, p, 0, count => {
      const bytes = new Uint8Array(count); bytes[0] = 1; return bytes;
    }) : P.integerShares(D.A, D.X);
    const a = made.A[index], rhs = made.c[index];
    let points;
    if (narrow) points = P.narrowCandidates([a], [rhs], p, 3);
    else {
      points = [];
      for (let x = 0; x < p; x++) for (let y = 0; y < p; y++) if (a[0] * x + a[1] * y === rhs) points.push([x, y]);
    }
    const secrets = narrow ? points.map(point => point[0]) : P.integerCandidates(a, rhs, p);
    $('pit-c-equation').textContent = `${a[0]}x₁+${a[1]}x₂${narrow ? '≡' : '='}${rhs}` + (narrow ? ` (mod ${p})` : '');
    $('pit-c-input').textContent = t(narrow ? 'pitNarrowInput' : 'pitIntegerInput');
    $('pit-c-unsafe').textContent = t('pitRestrictedResult', { count: secrets.length, secrets: secrets.join(', ') });
    const full = G.sCandidates([a], [G.mod(rhs, p)], p, 2).filter(Boolean).length;
    $('pit-c-result').textContent = t('pitFullResult', { count: full });
    $('pit-c-lesson').textContent = t(narrow ? 'pitNarrowLesson' : 'pitIntegerLesson');
    graph($('pit-c-grid'), p, [{ id: index, points }]); table($('pit-c-table'), ['s', 'x₂'], points);
  }
  function renderPitA() {
    const mode = state.pitAMode, is3 = mode === 'leak3', short = mode === 'short';
    const example = short ? { p: 13, k: 2, A: [DEFAULTS[2].A[0]], c: [DEFAULTS[2].c[0]] } : pitModel(mode);
    const { p, k, A, c } = example, count = G.solutionSpace(A, c, p, k).count;
    const secrets = G.sCandidates(A, c, p, k).map((n, s) => n ? s : null).filter(s => s !== null);
    $('pit-a-mode').value = mode; $('pit-a-s-wrap').hidden = !is3; $('pit-a-s').value = String(state.pitASlice);
    $('pit-a-input').textContent = A.map((row, i) => `#${i + 1}: ${fmtEquation(row, c[i], p)}`).join('; ');
    if (mode === 'parallel') $('pit-a-unsafe').textContent = t('pitCramerResult', { point: fmtPoint(P.cramerUnchecked(A, c, p)) });
    else if (short) $('pit-a-unsafe').textContent = t('pitFreeZeroResult', { point: fmtPoint(P.freeVariablesZero(A, c, p)) });
    else $('pit-a-unsafe').textContent = t('pitLeakedResult', { secrets: secrets.join(', '), count });
    $('pit-a-result').textContent = t(mode === 'parallel' ? 'pitParallelCheck' : short ? 'pitShortCheck' : 'pitLeakCheck');
    $('pit-a-lesson').textContent = t({ vertical: 'pitVerticalLesson', leak3: 'pitLeak3Lesson', parallel: 'pitParallelLesson', short: 'pitShortLesson' }[mode]);
    const checks = G.checkRows(A, p);
    table($('pit-a-checks'), [t('subset'), t('criterion'), t('judgment')], checks.map(row => [
      '{' + row.T.map(i => i + 1).join(',') + '}', t(row.kind === 'i' ? 'checkI' : 'checkII'), t(row.ok ? 'pass' : 'fail')
    ]));
    let series;
    $('pit-a-slices').hidden = !is3;
    if (is3) {
      $('pit-a-slices').replaceChildren(...Array.from({ length: p }, (_, s) => {
        const points = G.slicePoints(A, c, p, s), button = E('button'); button.type = 'button';
        button.id = 'pit-a-slice-' + s; button.dataset.aSlice = String(s); button.dataset.points = JSON.stringify(points);
        button.setAttribute('aria-pressed', String(s === state.pitASlice));
        button.append(smallSlice(points, p, s === state.pitASlice), E('span', `s=${s}: ` + t('pointCount', { count: points.length }))); return button;
      }));
      series = A.map((row, i) => ({ id: i, points: G.slicePoints([row], [c[i]], p, state.pitASlice) }));
      graph($('pit-a-grid'), p, series, { slice: true, common: G.slicePoints(A, c, p, state.pitASlice) });
    } else {
      series = A.map((row, i) => ({ id: i, points: G.linePoints(row, c[i], p) }));
      graph($('pit-a-grid'), p, series);
    }
    pointsTable('pit-a-table', p, series);
    $('pit-a-grid').dataset.secrets = JSON.stringify(secrets); $('pit-a-grid').dataset.solutionCount = String(count);
  }
  function renderPitD() {
    const D = DEFAULTS[2], p = D.p, count = state.pitDCount, delta = state.pitDDelta;
    const A = D.A.slice(0, count), c = D.c.slice(0, count); c[1] = G.mod(c[1] + delta, p);
    $('pit-d-count').value = String(count); $('pit-d-delta').value = String(delta);
    $('pit-d-input').textContent = t('pitTamperInput', { delta, before: D.c[1], after: c[1], count });
    const unchecked = P.restoreFirstK(A, c, p), recovery = G.reconstruction(A, c, p);
    $('pit-d-unsafe').textContent = t('pitFirstKResult', { point: fmtPoint(unchecked), s: unchecked[0] });
    let key = 'pitTamperK', values = { point: fmtPoint(unchecked), s: unchecked[0] };
    if (delta === 0) key = 'pitTamperUnchanged';
    else if (count === 3) key = 'pitTamperK1';
    else if (count === 4) { key = 'pitTamperK2'; values = { bad: recovery.suspects.map(i => '#' + (i + 1)).join(', ') }; }
    $('pit-d-result').textContent = t(key, values); $('pit-d-result').dataset.suspects = JSON.stringify(recovery.suspects);
    const series = A.map((row, i) => ({ id: i, points: G.linePoints(row, c[i], p) }));
    let secret = count === 2 || delta === 0 ? unchecked : null;
    if (count === 4 && delta !== 0 && recovery.suspects.length === 1) secret = recovery.groups[0].X;
    graph($('pit-d-grid'), p, series, { secret }); pointsTable('pit-d-points', p, series);
    table($('pit-d-table'), [t('subset'), t('point'), 's'], recovery.combinations.map(item => [
      item.T.map(i => '#' + (i + 1)).join(', '), fmtPoint(item.X), item.X[0]
    ]));
    table($('pit-d-linearity'), ['δ', 's'], Array.from({ length: p }, (_, change) => [change,
      G.solve(D.A.slice(0, 2), [D.c[0], G.mod(D.c[1] + change, p)], p)[0]]));
  }
  function renderPitfalls() { renderPitB(); renderPitC(); renderPitA(); renderPitD(); }
  function bindPitfalls() {
    for (const k of [2, 3]) $('pit-b-k' + k).addEventListener('click', () => { state.pitBK = k; state.pitBCount = 0; render(); });
    $('pit-b-picks').addEventListener('click', event => {
      const button = event.target.closest('[data-b-count]'); if (button) { state.pitBCount = Number(button.dataset.bCount); render(); }
    });
    for (const [id, key, numeric] of [['pit-c-mode', 'pitCMode'], ['pit-c-share', 'pitCShare', true], ['pit-a-mode', 'pitAMode'],
      ['pit-a-s', 'pitASlice', true], ['pit-d-count', 'pitDCount', true], ['pit-d-delta', 'pitDDelta', true]]) {
      $(id).addEventListener('change', event => { state[key] = numeric ? Number(event.target.value) : event.target.value; render(); });
    }
    $('pit-a-slices').addEventListener('click', event => {
      const button = event.target.closest('[data-a-slice]'); if (button) { state.pitASlice = Number(button.dataset.aSlice); render(); }
    });
  }

  const COMPARE_K2 = {
    p: 13, A: [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]], X: [5, 4], c: [9, 0, 4, 8, 12]
  };
  const COMPARE_K3 = {
    p: 13, A: [[1, 1, 1], [1, 2, 4], [1, 3, 9], [1, 4, 3], [1, 5, 12]], X: [5, 4, 2], c: [11, 8, 9, 1, 10]
  };

  function comparePolynomial(point) {
    const terms = [];
    point.forEach((coefficient, power) => {
      if (!coefficient) return;
      if (!power) terms.push(String(coefficient));
      else terms.push((coefficient === 1 ? '' : coefficient) + (power === 1 ? 'x' : 'x²'));
    });
    return 'f(x) = ' + (terms.length ? terms.join(' + ') : '0');
  }

  function compareValue(point, x, p) {
    return point.reduceRight((value, coefficient) => G.mod(value * x + coefficient, p), 0);
  }

  function comparePoints() {
    const D = COMPARE_K3;
    return state.compareNonzero ? P.nonzeroCandidates(D.A.slice(0, 2), D.c.slice(0, 2), D.p)
      : G.solutionPoints(D.A.slice(0, 2), D.c.slice(0, 2), D.p);
  }

  function compareScale(svg, p) {
    const width = Number(svg.getAttribute('viewBox').split(' ')[2]);
    return graphScale(width, p);
  }

  function renderComparePolynomial(svg, point, candidates) {
    const p = COMPARE_K3.p;
    graph(svg, p, [], { axisX: 'x', axisY: 'f(x)' });
    const { X, Y } = compareScale(svg, p);
    const background = new Map();
    for (const candidate of candidates) {
      for (let x = 0; x < p; x++) {
        const y = compareValue(candidate, x, p);
        background.set(x + ',' + y, [x, y]);
      }
    }
    const context = S('g', { class: 'compare-poly-context', 'aria-hidden': 'true' });
    for (const [x, y] of background.values()) context.append(S('circle', { cx: X(x), cy: Y(y), r: 1.5 }));
    svg.append(context);
    const values = Array.from({ length: p }, (_, x) => [x, compareValue(point, x, p)]);
    if (state.compareGuides) {
      const segments = values.map(([x, y], i) => {
        const gap = !i || Math.abs(y - values[i - 1][1]) > p / 2;
        return (gap ? 'M' : 'L') + X(x) + ',' + Y(y);
      });
      svg.append(S('path', { d: segments.join(' '), class: 'compare-poly-guide' }));
    }
    for (const [x, y] of values) {
      svg.append(S('circle', { cx: X(x), cy: Y(y), r: 3, class: 'compare-poly-point', 'data-point': JSON.stringify([x, y]) }));
    }
    for (let i = 0; i < 2; i++) {
      svg.append(S('circle', { cx: X(i + 1), cy: Y(COMPARE_K3.c[i]), r: 6, class: 'compare-observed-ring' }));
    }
    svg.dataset.candidate = String(point[0]);
    svg.dataset.coefficients = JSON.stringify(point);
    svg.dataset.points = JSON.stringify(values);
    svg.dataset.observed = JSON.stringify(COMPARE_K3.c.slice(0, 2).map((value, i) => [i + 1, value]));
  }

  function renderCompareRows(points) {
    const headings = ['s', t('comparePointHeading'), t('comparePolynomialHeading'), 'x=1', 'x=2'];
    const tbody = $('compare-rows');
    tbody.replaceChildren(...points.map(point => {
      const row = E('tr');
      row.dataset.secret = String(point[0]);
      row.dataset.coefficients = JSON.stringify(point);
      row.dataset.selected = String(point[0] === state.compareCandidate);
      const first = E('td');
      const button = E('button', 's=' + point[0]);
      button.type = 'button';
      button.id = 'compare-pick-' + point[0];
      button.dataset.compareCandidate = String(point[0]);
      button.setAttribute('aria-pressed', String(point[0] === state.compareCandidate));
      button.setAttribute('aria-label', t('compareChooseRow', { s: point[0] }));
      first.append(button);
      const coordinate = E('td', fmtPoint(point));
      const polynomial = E('td');
      polynomial.append(E('span', comparePolynomial(point), 'compare-polynomial-text'));
      if (point[2] === 0) {
        const badge = E('span', t('compareZeroTopBadge'), 'compare-zero-badge');
        badge.id = 'compare-zero-top';
        polynomial.append(badge);
      }
      const cells = [first, coordinate, polynomial, E('td', compareValue(point, 1, COMPARE_K3.p)),
        E('td', compareValue(point, 2, COMPARE_K3.p))];
      cells.forEach((cell, i) => { cell.dataset.label = headings[i]; row.append(cell); });
      return row;
    }));
    $('compare-table').dataset.candidates = String(points.length);
    $('compare-table').dataset.nonzero = String(state.compareNonzero);
  }

  function renderCompare() {
    const L = COMPARE_K2;
    const linearPoints = G.linePoints(L.A[0], L.c[0], L.p);
    const selectedLinear = linearPoints.find(point => point[0] === state.compareK2Candidate) || linearPoints[0];
    state.compareK2Candidate = selectedLinear[0];
    $('compare-k2-value').textContent = 's=' + selectedLinear[0];
    $('compare-k2-caption').textContent = t('compareK2Candidate', {
      point: fmtPoint(selectedLinear), polynomial: comparePolynomial(selectedLinear), value: compareValue(selectedLinear, 1, L.p)
    });
    $('compare-k2-shares').textContent = t('compareKnownShares', { count: 1, values: fmtPoint([1, L.c[0]]) });
    $('compare-k2-all-shares').textContent = t('compareAllShares', { values: L.c.map((value, i) => fmtPoint([i + 1, value])).join(' ') });
    $('compare-k2-answer').textContent = t('compareDealerAnswer', { polynomial: comparePolynomial(L.X), p: L.p, point: fmtPoint(L.X) });
    graph($('compare-k2-grid'), L.p, [{ id: 0, points: linearPoints }], {
      candidate: selectedLinear[0], axisX: 's', axisY: 'a₁'
    });
    $('compare-k2-grid').dataset.candidate = String(selectedLinear[0]);
    $('compare-k2-grid').dataset.point = JSON.stringify(selectedLinear);
    table($('compare-linear-table'), ['s', '(s,a₁)', t('comparePolynomialHeading'), 'f(1)'], linearPoints.map(point => [
      point[0], fmtPoint(point), comparePolynomial(point), compareValue(point, 1, L.p)
    ]));
    const D = COMPARE_K3;
    const points = comparePoints();
    if (!points.some(point => point[0] === state.compareCandidate)) state.compareCandidate = points[0][0];
    const point = points.find(candidate => candidate[0] === state.compareCandidate);
    $('compare-nonzero').checked = state.compareNonzero;
    $('compare-guides').checked = state.compareGuides;
    $('compare-current').textContent = 's=' + point[0];
    $('compare-count').textContent = t(state.compareNonzero ? 'compareRestrictedCount' : 'compareCompleteCount', { count: points.length });
    $('compare-k3-shares').textContent = t('compareKnownShares', { count: 2, values: D.c.slice(0, 2).map((value, i) => fmtPoint([i + 1, value])).join(' ') });
    $('compare-k3-all-shares').textContent = t('compareAllShares', { values: D.c.map((value, i) => fmtPoint([i + 1, value])).join(' ') });
    $('compare-fixed-polynomial').textContent = t('compareDealerAnswer', { polynomial: comparePolynomial(D.X), p: D.p, point: fmtPoint(D.X) });
    $('compare-poly-caption').textContent = t('compareSelectedPolynomial', { polynomial: comparePolynomial(point) });
    $('compare-slice-caption').textContent = t('compareSelectedSlice', { s: point[0], point: fmtPoint(point.slice(1)) });
    renderComparePolynomial($('compare-poly'), point, points);
    renderCompareRows(points);
    const series = D.A.slice(0, 2).map((row, i) => ({ id: i, points: G.slicePoints([row], [D.c[i]], D.p, point[0]) }));
    const slice = G.slicePoints(D.A.slice(0, 2), D.c.slice(0, 2), D.p, point[0]);
    graph($('compare-slice'), D.p, series, { slice: true, common: slice, axisX: 'a₁', axisY: 'a₂' });
    $('compare-slice').dataset.candidate = String(point[0]);
    $('compare-slice').dataset.coefficients = JSON.stringify(point);
    $('compare-slice').dataset.point = JSON.stringify(point.slice(1));
    $('compare-slice').dataset.intersections = JSON.stringify(slice);
    table($('compare-poly-table'), ['x', 'f(x)'], Array.from({ length: D.p }, (_, x) => [x, compareValue(point, x, D.p)]));
    table($('compare-slice-table'), ['s', '(s,a₁,a₂)', 'f(1)', 'f(2)'], [
      [point[0], fmtPoint(point), compareValue(point, 1, D.p), compareValue(point, 2, D.p)]
    ]);
    const k = D.X.length;
    table($('compare-size-table'), [t('compareSizeMethod'), t('compareSizeFormula'), 'm=1', 'm=16'], [
      [t('compareSizeEach'), 'm·k', k, 16 * k],
      [t('compareSizeReuse'), 'm+k−1', k, 16 + k - 1],
      [t('compareSizePublic'), 'm', 1, 16]
    ]);
    table($('compare-equivalence-table'), [t('compareShamirSide'), t('compareBlakleySide')], [
      [t('compareObservedPair'), 's + 2a₁ + 4a₂ ≡ 8 (mod 13)'],
      [t('compareShamirObject'), t('compareBlakleyObject')]
    ]);
  }

  function compareMove(delta) {
    const points = comparePoints();
    const index = points.findIndex(point => point[0] === state.compareCandidate);
    state.compareCandidate = points[(index + delta + points.length) % points.length][0];
    render();
  }

  function bindCompare() {
    $('compare-k2-prev').addEventListener('click', () => {
      state.compareK2Candidate = G.mod(state.compareK2Candidate - 1, COMPARE_K2.p); render();
    });
    $('compare-k2-next').addEventListener('click', () => {
      state.compareK2Candidate = G.mod(state.compareK2Candidate + 1, COMPARE_K2.p); render();
    });
    $('compare-prev').addEventListener('click', () => compareMove(-1));
    $('compare-next').addEventListener('click', () => compareMove(1));
    $('compare-nonzero').addEventListener('change', event => { state.compareNonzero = event.target.checked; render(); });
    $('compare-guides').addEventListener('change', event => { state.compareGuides = event.target.checked; render(); });
    $('compare-rows').addEventListener('click', event => {
      const button = event.target.closest('[data-compare-candidate]');
      if (!button) return;
      state.compareCandidate = Number(button.dataset.compareCandidate); render();
    });
    $('compare-rows').addEventListener('keydown', event => {
      const button = event.target.closest('[data-compare-candidate]');
      if (!button || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const points = comparePoints();
      const index = points.findIndex(point => point[0] === Number(button.dataset.compareCandidate));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + points.length) % points.length;
      state.compareCandidate = points[next][0]; render();
      $('compare-pick-' + state.compareCandidate).focus({ preventScroll: true });
    });
    $('compare-lesson').addEventListener('click', () => {
      $('help-dialog').showModal();
      const section = $('lesson-8');
      if (section) {
        section.open = true; section.scrollIntoView({ block: 'start' });
        section.querySelector('summary').focus({ preventScroll: true });
      }
    });
  }
  bindIntersections();
  bindPitfalls();
  bindCompare();
  render();
  document.getElementById('startup-tools').disabled = false;
  document.getElementById('startup-controls').disabled = false;
  document.getElementById('startup-note').hidden = true;
  document.documentElement.dataset.appReady = 'true';
}());
