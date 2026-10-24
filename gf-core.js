(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BlakleyGF = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Algorithms follow the Day126 MIT reference. Inputs and returned arrays are independent.
  const rawMod = (a, p) => ((a % p) + p) % p;
  const copy = rows => rows.map(row => row.slice());
  const fields = [7, 11, 13];

  function integer(value, name) {
    if (!Number.isSafeInteger(value)) throw new TypeError(name + ' must be a safe integer');
  }

  function field(p) {
    if (!fields.includes(p)) throw new RangeError('p must be 7, 11, or 13');
  }

  function dimension(k) {
    integer(k, 'k');
    if (k < 1 || k > 5) throw new RangeError('k must be from 1 to 5');
  }

  function matrix(rows, cols) {
    if (!Array.isArray(rows)) throw new TypeError('matrix must be an array');
    const width = cols === undefined ? (rows.length ? rows[0].length : 0) : cols;
    if (!Number.isSafeInteger(width) || width < 0) throw new TypeError('invalid matrix width');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== width) throw new TypeError('matrix rows must have equal lengths');
      for (const value of row) integer(value, 'matrix element');
    }
    return width;
  }

  function system(A, c, p, k) {
    field(p);
    const width = matrix(A, k);
    dimension(width);
    if (!Array.isArray(c) || c.length !== A.length) throw new TypeError('right-hand side length differs');
    c.forEach(value => integer(value, 'right-hand side'));
    return width;
  }

  function mod(a, p) {
    field(p);
    integer(a, 'a');
    return rawMod(a, p);
  }

  function rawInv(a, p) {
    let value = rawMod(a, p);
    if (value === 0) throw new RangeError('inverse of zero');
    let result = 1;
    let exponent = p - 2;
    while (exponent > 0) {
      if (exponent & 1) result = result * value % p;
      value = value * value % p;
      exponent >>= 1;
    }
    return result;
  }

  function inv(a, p) {
    field(p);
    integer(a, 'a');
    return rawInv(a, p);
  }

  function rawDot(a, x, p) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += rawMod(a[i], p) * rawMod(x[i], p);
    return rawMod(sum, p);
  }

  function dot(a, x, p) {
    field(p);
    matrix([a, x]);
    return rawDot(a.map(value => rawMod(value, p)), x.map(value => rawMod(value, p)), p);
  }

  function reduce(rows, p, coefficientColumns, record) {
    const m = rows.map(row => row.map(value => rawMod(value, p)));
    const pivots = [];
    const steps = record ? [{ op: 'start', m: copy(m) }] : [];
    let rk = 0;
    const save = op => { if (record) steps.push({ op, m: copy(m) }); };
    for (let col = 0; col < coefficientColumns && rk < m.length; col++) {
      let pivot = rk;
      while (pivot < m.length && m[pivot][col] === 0) pivot++;
      if (pivot === m.length) continue;
      if (pivot !== rk) {
        [m[rk], m[pivot]] = [m[pivot], m[rk]];
        save('R' + (rk + 1) + '<->R' + (pivot + 1));
      }
      if (m[rk][col] !== 1) {
        const factor = rawInv(m[rk][col], p);
        m[rk] = m[rk].map(value => value * factor % p);
        save('R' + (rk + 1) + '<-R' + (rk + 1) + '*' + factor);
      }
      for (let row = 0; row < m.length; row++) {
        if (row === rk || m[row][col] === 0) continue;
        const factor = m[row][col];
        m[row] = m[row].map((value, j) => rawMod(value - factor * m[rk][j], p));
        save('R' + (row + 1) + '<-R' + (row + 1) + '-' + factor + '*R' + (rk + 1));
      }
      pivots.push(col);
      rk++;
    }
    return { m, rank: rk, pivots, steps };
  }

  function rref(rows, p) {
    field(p);
    const cols = matrix(rows);
    const { m, rank: rk, pivots } = reduce(rows, p, cols, false);
    return { m, rank: rk, pivots };
  }

  function rank(rows, p) {
    return rref(rows, p).rank;
  }

  function solve(A, c, p) {
    const k = system(A, c, p);
    const result = reduce(A.map((row, i) => [...row, c[i]]), p, k, false);
    if (result.rank !== k || result.m.some(row => row.slice(0, k).every(v => v === 0) && row[k] !== 0)) return null;
    return result.m.slice(0, k).map(row => row[k]);
  }

  function gaussJordanSteps(A, c, p) {
    const k = system(A, c, p);
    return reduce(A.map((row, i) => [...row, c[i]]), p, k, true).steps;
  }

  function annihilator(rows, p, k) {
    field(p);
    const width = matrix(rows, k);
    dimension(width);
    const result = reduce(rows, p, width, false);
    const free = Array.from({ length: width }, (_, i) => i).filter(i => !result.pivots.includes(i));
    return free.map(col => {
      const vector = new Array(width).fill(0);
      vector[col] = 1;
      result.pivots.forEach((pivot, row) => { vector[pivot] = rawMod(-result.m[row][col], p); });
      return vector;
    });
  }

  function* combinations(n, r) {
    integer(n, 'n');
    integer(r, 'r');
    if (n < 0 || r < 0) throw new RangeError('combination sizes must not be negative');
    if (r > n) return;
    function* visit(start, chosen) {
      if (chosen.length === r) { yield chosen.slice(); return; }
      for (let i = start; i <= n - (r - chosen.length); i++) {
        chosen.push(i);
        yield* visit(i + 1, chosen);
        chosen.pop();
      }
    }
    yield* visit(0, []);
  }

  function binom(n, r) {
    integer(n, 'n');
    integer(r, 'r');
    if (n < 0 || r < 0) throw new RangeError('combination sizes must not be negative');
    if (r > n) return 0;
    let result = 1;
    for (let i = 0; i < r; i++) result = result * (n - i) / (i + 1);
    return Math.round(result);
  }

  function e1(k) {
    dimension(k);
    return [1, ...new Array(k - 1).fill(0)];
  }

  function checkRows(A, p) {
    field(p);
    const k = matrix(A);
    dimension(k);
    const result = [];
    for (const T of combinations(A.length, k)) {
      const rk = rank(T.map(i => A[i]), p);
      result.push({ kind: 'i', T, rank: rk, ok: rk === k });
    }
    for (const T of combinations(A.length, k - 1)) {
      const rk = rank([e1(k), ...T.map(i => A[i])], p);
      result.push({ kind: 'ii', T, rank: rk, ok: rk === k });
    }
    return result;
  }

  function check(A, p) {
    const rows = checkRows(A, p);
    const badI = rows.filter(row => row.kind === 'i' && !row.ok).map(row => row.T);
    const badII = rows.filter(row => row.kind === 'ii' && !row.ok).map(row => row.T);
    return { ok: badI.length === 0 && badII.length === 0, badI, badII };
  }

  function representatives(p, k) {
    field(p);
    dimension(k);
    const out = [];
    // Skip leading-zero blocks directly, retaining the reference's base-p order.
    for (let first = k - 1; first >= 0; first--) {
      for (let t = 0; t < p ** (k - first - 1); t++) {
        const vector = new Array(k).fill(0);
        vector[first] = 1;
        let rest = t;
        for (let col = k - 1; col > first; col--) {
          vector[col] = rest % p;
          rest = Math.floor(rest / p);
        }
        out.push(vector);
      }
    }
    return out;
  }

  function forbiddenAnnihilators(A, p, k) {
    field(p);
    dimension(k);
    matrix(A, k);
    const B = [e1(k), ...A];
    const size = Math.min(k - 1, B.length);
    return [...combinations(B.length, size)].map(T => annihilator(T.map(i => B[i]), p, k));
  }

  function allowed(A, p, k, reps) {
    const forbidden = forbiddenAnnihilators(A, p, k);
    const candidates = reps === undefined ? representatives(p, k) : reps;
    matrix(candidates, k);
    return candidates.filter(vector => forbidden.every(basis => basis.some(h => rawDot(h, vector, p) !== 0)));
  }

  function randomChunk(rng, count) {
    if (typeof rng !== 'function') throw new TypeError('randomBytes must be a function');
    const bytes = rng(count);
    if (!(bytes instanceof Uint8Array) || bytes.length !== count) throw new TypeError('randomBytes must return the requested Uint8Array');
    return bytes;
  }

  function randField(p, rng) {
    field(p);
    const limit = 256 - (256 % p);
    for (;;) {
      const value = randomChunk(rng, 1)[0];
      if (value < limit) return value % p;
    }
  }

  function randIndex(size, rng) {
    integer(size, 'candidate count');
    if (size < 1 || size > 2 ** 32) throw new RangeError('candidate count must be from 1 to 2^32');
    const limit = 2 ** 32 - (2 ** 32 % size);
    for (let attempt = 0; attempt < 64; attempt++) {
      const bytes = randomChunk(rng, 4);
      const value = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
      if (value < limit) return value % size;
    }
    throw new Error('random index rejection limit exceeded');
  }

  function makeDetRng() {
    let count = 0;
    const rng = size => {
      const bytes = new Uint8Array(size);
      for (let j = 0; j < size; j++, count++) bytes[j] = (37 * count + 11) & 255;
      return bytes;
    };
    rng.count = () => count;
    return rng;
  }

  function generation(p, k, n) {
    field(p);
    dimension(k);
    integer(n, 'n');
    if (k < 2 || n < k || n > p) throw new RangeError('generation requires 2 <= k <= n <= p');
  }

  function* sequentialNormalAttempts(p, k, n, rng, maxAttempts = 1000) {
    generation(p, k, n);
    integer(maxAttempts, 'maxAttempts');
    if (maxAttempts < 1 || maxAttempts > 1000) throw new RangeError('maxAttempts must be from 1 to 1000');
    if (typeof rng !== 'function') throw new TypeError('randomBytes must be a function');
    const reps = representatives(p, k);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const A = [];
      const candidateCounts = [];
      while (A.length < n) {
        const candidates = allowed(A, p, k, reps);
        candidateCounts.push(candidates.length);
        if (candidates.length === 0) break;
        A.push(candidates[randIndex(candidates.length, rng)].slice());
      }
      const normals = A.length === n ? A : null;
      yield { A: normals, normals, attempts: attempt, candidateCounts };
      if (normals) return;
    }
  }

  function sequentialNormals(p, k, n, rng, maxAttempts = 1000) {
    let last;
    for (const result of sequentialNormalAttempts(p, k, n, rng, maxAttempts)) last = result;
    return last;
  }

  function vandermonde(p, k, n) {
    generation(p, k, n);
    if (n >= p) throw new RangeError('Vandermonde requires nonzero distinct indices, n < p');
    return Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, j) => (i + 1) ** j % p));
  }

  function completeShares(p, k, n, s, A, rng, attempts = 0) {
    generation(p, k, n);
    integer(s, 's');
    if (s < 0 || s >= p) throw new RangeError('s must be a field element');
    matrix(A, k);
    if (A.length !== n || !check(A, p).ok) throw new RangeError('normals must pass both checks');
    const X = [s, ...Array.from({ length: k - 1 }, () => randField(p, rng))];
    return { p, k, n, X, A: copy(A), c: A.map(row => rawDot(row, X, p)), attempts };
  }

  function makeShares(p, k, n, s, rng, mode = 'random', maxAttempts = 1000) {
    generation(p, k, n);
    integer(s, 's');
    if (s < 0 || s >= p) throw new RangeError('s must be a field element');
    if (mode !== 'random' && mode !== 'vandermonde') throw new RangeError('unknown generation mode');
    const normals = mode === 'vandermonde'
      ? { A: vandermonde(p, k, n), attempts: 0 }
      : sequentialNormals(p, k, n, rng, maxAttempts);
    if (!normals.A) return null;
    return completeShares(p, k, n, s, normals.A, rng, normals.attempts);
  }

  function solutionSpace(A, c, p, k) {
    const width = system(A, c, p, k);
    const result = reduce(A.map((row, i) => [...row, c[i]]), p, width, false);
    const inconsistent = result.m.some(row => row.slice(0, width).every(v => v === 0) && row[width] !== 0);
    const base = new Array(width).fill(0);
    if (!inconsistent) result.pivots.forEach((col, row) => { base[col] = result.m[row][width]; });
    const basis = annihilator(A, p, width);
    return {
      consistent: !inconsistent, base: inconsistent ? null : base, basis, rank: result.rank,
      count: inconsistent ? 0 : p ** basis.length, m: result.m, pivots: result.pivots
    };
  }

  function solutionPoints(A, c, p, k, limit = 10000) {
    integer(limit, 'point limit');
    if (limit < 1) throw new RangeError('point limit must be positive');
    const space = solutionSpace(A, c, p, k);
    if (!space.consistent) return [];
    if (space.count > limit) throw new RangeError('too many points to enumerate');
    const points = [];
    for (let t = 0; t < space.count; t++) {
      const point = space.base.slice();
      let rest = t;
      for (const vector of space.basis) {
        const coefficient = rest % p;
        rest = Math.floor(rest / p);
        for (let j = 0; j < point.length; j++) point[j] = rawMod(point[j] + coefficient * vector[j], p);
      }
      points.push(point);
    }
    return points.sort((a, b) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    });
  }

  function sCandidates(A, c, p, k) {
    const space = solutionSpace(A, c, p, k);
    const counts = new Array(p).fill(0);
    if (!space.consistent) return counts;
    if (space.basis.some(vector => vector[0] !== 0)) return counts.fill(space.count / p);
    counts[space.base[0]] = space.count;
    return counts;
  }

  function slicePoints(A, c, p, s) {
    system(A, c, p, 3);
    integer(s, 's');
    if (s < 0 || s >= p) throw new RangeError('s must be a field element');
    const rows = A.map(row => row.slice(1));
    const rhs = A.map((row, i) => rawMod(rawMod(c[i], p) - rawMod(row[0], p) * s, p));
    return solutionPoints(rows, rhs, p, 2);
  }

  function linePoints(a, c, p) {
    system([a], [c], p, 2);
    return solutionPoints([a], [c], p, 2);
  }

  function reconstruction(A, c, p) {
    const k = system(A, c, p);
    const results = [...combinations(A.length, k)].map(T => ({
      T, X: solve(T.map(i => A[i]), T.map(i => c[i]), p)
    }));
    const groups = [];
    for (const result of results) {
      if (!result.X) continue;
      let group = groups.find(item => item.X.every((value, i) => value === result.X[i]));
      if (!group) {
        const support = A.map((row, i) => rawDot(row, result.X, p) === rawMod(c[i], p) ? i : -1).filter(i => i !== -1);
        const rejected = A.map((_, i) => i).filter(i => !support.includes(i));
        group = { X: result.X.slice(), support, rejected, count: 0 };
        groups.push(group);
      }
      group.count++;
    }
    groups.sort((a, b) => b.support.length - a.support.length || b.count - a.count);
    const allAgree = results.length > 0 && results.every(item => item.X !== null) && groups.length === 1;
    const best = groups[0];
    const uniqueBest = best && (groups.length === 1 || best.support.length > groups[1].support.length);
    const canIdentify = A.length >= k + 2 && check(A, p).ok && uniqueBest && best.rejected.length === 1;
    return {
      combinations: results, allAgree, X: allAgree ? groups[0].X.slice() : null, groups,
      suspects: canIdentify ? best.rejected.slice() : []
    };
  }

  return Object.freeze({
    mod, inv, dot, rref, rank, solve, gaussJordanSteps, annihilator, combinations, binom, e1,
    check, checkRows, representatives, forbiddenAnnihilators, allowed, allowedNormals: allowed,
    randField, randIndex, makeDetRng, sequentialNormals, sequentialNormalAttempts, vandermonde, completeShares, makeShares,
    solutionSpace, solutionPoints, sCandidates, slicePoints, linePoints, reconstruction
  });
}));