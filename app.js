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
  const state = {
    language: queryLanguage || validLanguage(stored('language')) || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
    theme: ['light', 'dark'].includes(savedTheme) ? savedTheme
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    tab: 'intersections',
    example: { p: 13, k: 2, n: 4, X: [5, 8], A: [[1, 3], [2, 5], [4, 2], [5, 1]], c: [3, 11, 10, 7] },
    selected: [0], candidate: 0, all: false, busy: false
  };
  const tabs = ['intersections', 'compare', 'pitfalls'];
  const t = key => BlakleyMessages[state.language][key] || key;
  function save() {
    try {
      localStorage.setItem('blakley-sharing-cipherlab.language', state.language);
      localStorage.setItem('blakley-sharing-cipherlab.theme', state.theme);
    } catch (_) { /* Preferences are optional. */ }
  }
  function render() {
    document.documentElement.lang = state.language;
    document.documentElement.dataset.theme = state.theme;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.label)); });
    $('language').textContent = state.language === 'ja' ? 'EN' : '日';
    for (const name of tabs) {
      const selected = name === state.tab;
      $('tab-' + name).setAttribute('aria-selected', String(selected));
      $('tab-' + name).tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
  }
  tabs.forEach((name, index) => {
    $('tab-' + name).addEventListener('click', () => { state.tab = name; render(); });
    $('tab-' + name).addEventListener('keydown', event => {
      const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!move && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + move + tabs.length) % tabs.length;
      state.tab = tabs[next]; render(); $('tab-' + state.tab).focus();
    });
  });
  $('theme').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); render(); });
  $('language').addEventListener('click', () => { state.language = state.language === 'ja' ? 'en' : 'ja'; save(); render(); });
  $('help').addEventListener('click', () => { $('help-dialog').showModal(); document.querySelector('.help-body').scrollTop = 0; });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...$('help-dialog').querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length > 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  render();
}());
