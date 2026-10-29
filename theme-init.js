/* BlakleySharing CipherLab - MIT (c) 2026 ipusiron. */
(function (global) {
  'use strict';
  let saved = null;
  try {
    saved = global.localStorage.getItem('blakley-sharing-cipherlab.theme');
  } catch (_) { /* Preferences are optional. */ }
  const prefersDark = typeof global.matchMedia === 'function'
    && global.matchMedia('(prefers-color-scheme: dark)').matches;
  global.document.documentElement.dataset.theme = ['light', 'dark'].includes(saved)
    ? saved : (prefersDark ? 'dark' : 'light');
}(typeof window !== 'undefined' ? window : globalThis));
