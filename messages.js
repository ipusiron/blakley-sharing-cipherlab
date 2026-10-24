/* BlakleySharing CipherLab - MIT (c) 2026 ipusiron. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlakleyMessages = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    ja: {
      theme: '明暗を切り替える', language: '言語を切り替える', help: 'ヘルプと座学', close: '閉じる',
      tablist: '学ぶ順番', intersections: '交点で追う', compare: 'Shamir と並べる', pitfalls: '確かめる',
      source: 'ソースコード',
      educational: '学習用。本物の秘密（パスワード・シード・鍵）は入れない。',
      practical: '実用のバックアップはDay124 Scatter Seedsへ。',
      intro: 'シェアは直線。2本が交わる点の第1座標が、秘密情報 s です。',
      initialExample: '既定の例（手で選んだ値）：GF(13)、k=2、n=4。',
      compareIntro: 'Day123ではシェアが点で、候補が直線（多項式）でした。ここではシェアが直線（平面）で、候補が点です。',
      pitfallsIntro: '点全体・整数と狭い乱数・検査・改ざんを、わざと無防備な模型と並べて確かめます。',
      helpIntro: 'タブは左右矢印・Home・Endで切り替えられます。ヘルプはEscで閉じられます。',
      premise: 'x₂…x_k は GF(p) 全体（0を含む）から一様に、秘密ごとに新しく、法線とは別に選ぶ。',
      reuse: '法線は公開・使い回してよい。使い回してはならないのは x₂…x_k。'
    },
    en: {
      theme: 'Switch light and dark', language: 'Switch language', help: 'Help and theory', close: 'Close',
      tablist: 'Learning steps', intersections: 'Intersections', compare: 'Compare with Shamir', pitfalls: 'Pitfalls',
      source: 'Source code',
      educational: 'For learning. Do not enter real secrets (passwords, seeds or keys).',
      practical: 'For practical backups, see Day124 Scatter Seeds.',
      intro: 'A share is a line. The first coordinate of the intersection of two lines is the secret s.',
      initialExample: 'Default example (hand-picked values): GF(13), k=2, n=4.',
      compareIntro: 'In Day123, shares were points and candidates were lines (polynomials). Here, shares are lines (planes) and candidates are points.',
      pitfallsIntro: 'Compare deliberately unprotected models of whole-point secrets, integers, narrow randomness, missing checks and tampering.',
      helpIntro: 'Switch tabs with Left, Right, Home and End. Close help with Esc.',
      premise: 'Choose x₂…x_k uniformly from all of GF(p), including 0, freshly for each secret and independently of the normals.',
      reuse: 'Normals may be public and reused. Do not reuse x₂…x_k.'
    }
  };
}));
