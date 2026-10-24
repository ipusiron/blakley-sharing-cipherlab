(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./gf-core.js'));
  else root.BlakleyPitfalls = factory(root.BlakleyGF);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (GF) {
  'use strict';

  // Deliberately unprotected models for the learning cards. Do not use for actual secrets.
  function integerShares(A, X) {
    return { A: A.map(row => row.slice()), X: X.slice(), c: A.map(row => row.reduce((sum, value, i) => sum + value * X[i], 0)) };
  }

  function integerCandidates(a, cInt, range) {
    const candidates = [];
    for (let s = 0; s < range; s++) {
      for (let r = 0; r < range; r++) {
        if (a[0] * s + a[1] * r === cInt) { candidates.push(s); break; }
      }
    }
    return candidates;
  }

  function pointCandidates(A, c, p, count) {
    const k = A[0].length;
    return GF.solutionSpace(A.slice(0, count), c.slice(0, count), p, k).count;
  }

  function restoreWholePoint(A, c, p) {
    const candidates = GF.solutionSpace(A, c, p);
    return { count: candidates.count, point: candidates.count === 1 ? candidates.base : null };
  }

  function narrowCandidates(A, c, p, maximum = 3) {
    return GF.solutionPoints(A, c, p).filter(point => point.slice(1).every(value => value <= maximum));
  }

  function nonzeroCandidates(A, c, p) {
    return GF.solutionPoints(A, c, p).filter(point => point.slice(1).every(value => value !== 0));
  }

  function narrowShares(A, p, s, randomBytes, range = 4) {
    const X = [s, ...Array.from({ length: A[0].length - 1 }, () => GF.randIndex(range, randomBytes))];
    return { p, A: A.map(row => row.slice()), X, c: A.map(row => GF.dot(row, X, p)) };
  }

  function uncheckedShares(p, k, n, s, randomBytes) {
    const A = Array.from({ length: n }, () => Array.from({ length: k }, () => GF.randField(p, randomBytes)));
    const X = [s, ...Array.from({ length: k - 1 }, () => GF.randField(p, randomBytes))];
    return { p, k, n, A, X, c: A.map(row => GF.dot(row, X, p)) };
  }

  function cramerUnchecked(A, c, p) {
    // This intentionally evaluates zero to the power p-2 instead of rejecting it.
    const det = GF.mod(A[0][0] * A[1][1] - A[0][1] * A[1][0], p);
    let inverse = 1;
    for (let exponent = 0; exponent < p - 2; exponent++) inverse = inverse * det % p;
    return [
      GF.mod((c[0] * A[1][1] - A[0][1] * c[1]) * inverse, p),
      GF.mod((A[0][0] * c[1] - c[0] * A[1][0]) * inverse, p)
    ];
  }

  function freeVariablesZero(A, c, p) {
    const k = A[0].length;
    const reduced = GF.rref(A.map((row, i) => [...row, c[i]]), p);
    const point = new Array(k).fill(0);
    reduced.pivots.forEach((column, i) => { if (column < k) point[column] = reduced.m[i][k]; });
    return point;
  }

  function restoreFirstK(A, c, p) {
    const k = A[0].length;
    return GF.solve(A.slice(0, k), c.slice(0, k), p);
  }

  return Object.freeze({
    integerShares, integerCandidates, pointCandidates, restoreWholePoint, narrowCandidates,
    nonzeroCandidates, narrowShares, uncheckedShares, cramerUnchecked, freeVariablesZero, restoreFirstK
  });
}));