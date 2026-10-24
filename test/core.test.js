'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const GF = require('../gf-core.js');
const Pitfalls = require('../pitfalls.js');
const V = require('./vectors.json');

function subset(rows, indices) {
  return indices.map(i => rows[i]);
}

function seededBytes(seed) {
  let state = seed >>> 0;
  return count => {
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      bytes[i] = state >>> 24;
    }
    return bytes;
  };
}

function byteSequence(values) {
  let count = 0;
  const rng = length => {
    assert.ok(count + length <= values.length, 'random byte fixture exhausted');
    const bytes = Uint8Array.from(values.slice(count, count + length));
    count += length;
    return bytes;
  };
  rng.count = () => count;
  return rng;
}

test('A: inverse of every nonzero element and modular arithmetic in all supported fields', () => {
  for (const p of [7, 11, 13]) {
    for (let value = 1; value < p; value++) {
      assert.equal(GF.mod(value * GF.inv(value, p), p), 1);
      assert.equal(GF.inv(value - p, p), GF.inv(value, p));
    }
    assert.equal(GF.mod(-p - 1, p), p - 1);
    assert.throws(() => GF.inv(0, p), RangeError);
    assert.throws(() => GF.inv(p, p), RangeError);
  }
});

for (const key of ['default_k2', 'default_k3', 'default_k4', 'default_k5']) {
  test('A: ' + key + ' all subsets recover the unnormalized fixed point', () => {
    const D = V[key];
    const before = JSON.stringify(D);
    const k = D.X.length;
    assert.deepEqual(D.A.map(row => GF.dot(row, D.X, D.p)), D.c);
    assert.deepEqual(GF.check(D.A, D.p), { ok: true, badI: [], badII: [] });
    const subsets = [...GF.combinations(D.A.length, k)];
    assert.equal(subsets.length, GF.binom(D.A.length, k));
    for (const T of subsets) assert.deepEqual(GF.solve(subset(D.A, T), subset(D.c, T), D.p), D.X);
    assert.equal(GF.reconstruction(D.A, D.c, D.p).allAgree, true);
    if (D.k !== undefined) assert.equal(D.k, k);
    if (D.n !== undefined) assert.equal(D.n, D.A.length);
    if (D.pairsAllRecover !== undefined) assert.equal(D.pairsAllRecover, subsets.every(T => {
      return JSON.stringify(GF.solve(subset(D.A, T), subset(D.c, T), D.p)) === JSON.stringify(D.X);
    }));
    assert.equal(JSON.stringify(D), before);
  });
}

for (const key of ['default_k4', 'default_k5']) {
  test('A: ' + key + ' every row operation and intermediate matrix matches steps123', () => {
    const D = V[key];
    const steps = GF.gaussJordanSteps(D.A.slice(0, D.k), D.c.slice(0, D.k), D.p);
    assert.deepEqual(steps, D.steps123);
    for (const step of steps) {
      assert.deepEqual(GF.solve(step.m.map(row => row.slice(0, D.k)), step.m.map(row => row[D.k]), D.p), D.X);
    }
    const underdetermined = GF.solutionSpace(D.A.slice(0, D.k - 1), D.c.slice(0, D.k - 1), D.p);
    assert.equal(underdetermined.rank, D.k - 1);
    assert.equal(underdetermined.basis.length, 1);
    assert.equal(underdetermined.count, D.p);
    assert.deepEqual(GF.sCandidates(D.A.slice(0, D.k - 1), D.c.slice(0, D.k - 1), D.p), new Array(D.p).fill(1));
  });
}

test('A: row reduction handles singular, inconsistent, underdetermined, and extra equations', () => {
  const P = V.parallel_k2;
  assert.equal(GF.rank(P.A, P.p), P.rank);
  assert.equal(GF.solve(P.A, P.c, P.p), null);
  assert.equal(GF.solve([P.A[0]], [P.c[0]], P.p), null);
  const changed = [P.c[0], GF.mod(P.c[1] + 1, P.p)];
  assert.equal(GF.solve(P.A, changed, P.p), null);
  assert.equal(GF.solutionSpace(P.A, changed, P.p).consistent, false);
  assert.deepEqual(GF.solutionPoints(P.A, changed, P.p), []);
  assert.deepEqual(GF.sCandidates(P.A, changed, P.p), new Array(P.p).fill(0));
  const D = V.default_k3;
  assert.deepEqual(GF.solve(D.A, D.c, D.p), D.X);
  assert.deepEqual(GF.rref([] , D.p), { m: [], rank: 0, pivots: [] });
  const steps = GF.gaussJordanSteps(P.A, P.c, P.p);
  assert.equal(GF.rank(steps.at(-1).m.map(row => row.slice(0, 2)), P.p), P.rank);
});

test('B: deterministic byte sequence and all representative counts and ordering', () => {
  assert.deepEqual(Array.from(GF.makeDetRng()(V.detRng_first16.length)), V.detRng_first16);
  for (const [key, count] of Object.entries(V.representativeCount)) {
    const [p, k] = key.split('-').map(Number);
    const representatives = GF.representatives(p, k);
    assert.equal(representatives.length, count);
    assert.equal(count, (p ** k - 1) / (p - 1));
    let previous = -1;
    for (const representative of representatives) {
      assert.equal(representative.find(value => value !== 0), 1);
      const value = representative.reduce((total, digit) => total * p + digit, 0);
      assert.ok(value > previous);
      previous = value;
    }
  }
});

for (const expected of V.sequential) {
  test('B: sequential reference ' + [expected.p, expected.k, expected.n].join('-') + ' including every byte and candidate count', () => {
    const { p, k, n, s } = expected;
    const rng = GF.makeDetRng();
    const result = GF.makeShares(p, k, n, s, rng);
    assert.ok(result);
    const reps = GF.representatives(p, k);
    const candidateCounts = result.A.map((_, i) => GF.allowedNormals(result.A.slice(0, i), p, k, reps).length);
    assert.deepEqual({
      p, k, n, s, A: result.A, X: result.X, c: result.c, attempts: result.attempts,
      candidateCounts, rngBytesUsed: rng.count()
    }, expected);
    assert.ok(GF.check(result.A, p).ok);
    for (const T of GF.combinations(n, k)) assert.deepEqual(GF.solve(subset(result.A, T), subset(result.c, T), p), result.X);
  });
}

test('B: per-attempt iterator preserves random sequence and exposes bounded failure', () => {
  const expected = V.sequential.find(row => row.attempts > 1);
  const rng = GF.makeDetRng();
  const attempts = [...GF.sequentialNormalAttempts(expected.p, expected.k, expected.n, rng)];
  assert.equal(attempts.length, expected.attempts);
  for (const attempt of attempts.slice(0, -1)) {
    assert.equal(attempt.A, null);
    assert.equal(attempt.normals, null);
    assert.equal(attempt.candidateCounts.at(-1), 0);
  }
  const last = attempts.at(-1);
  assert.deepEqual(last.A, expected.A);
  assert.deepEqual(last.normals, expected.A);
  assert.deepEqual(last.candidateCounts, expected.candidateCounts);
  const completed = GF.completeShares(expected.p, expected.k, expected.n, expected.s, last.A, rng, last.attempts);
  assert.deepEqual(completed.X, expected.X);
  assert.deepEqual(completed.c, expected.c);
  assert.equal(rng.count(), expected.rngBytesUsed);
  const failed = GF.sequentialNormals(expected.p, expected.k, expected.n, GF.makeDetRng(), 1);
  assert.equal(failed.normals, null);
  assert.equal(failed.A, null);
  assert.equal(failed.attempts, 1);
  assert.equal(GF.makeShares(expected.p, expected.k, expected.n, expected.s, GF.makeDetRng(), 'random', 1), null);
});

for (const p of [7, 11, 13]) {
  for (let k = 2; k <= 5; k++) {
    test('B: seeded generation for every UI n, five independent seeds, p=' + p + ' k=' + k, () => {
      for (let n = k; n <= Math.min(8, p - 1); n++) {
        for (let repetition = 1; repetition <= 5; repetition++) {
          const rng = seededBytes((p * 10000 + k * 1000 + n * 100 + repetition) >>> 0);
          const result = GF.makeShares(p, k, n, repetition % p, rng);
          assert.ok(result, 'generator exhausted p=' + p + ' k=' + k + ' n=' + n);
          assert.ok(GF.check(result.A, p).ok);
          assert.deepEqual(GF.solve(result.A, result.c, p), result.X);
          assert.equal(result.X[0], repetition % p);
          assert.ok(result.X.every(value => value >= 0 && value < p));
        }
        const A = GF.vandermonde(p, k, n);
        assert.ok(GF.check(A, p).ok);
        const result = GF.makeShares(p, k, n, 0, seededBytes(p + k + n), 'vandermonde');
        assert.deepEqual(result.A, A);
        assert.equal(result.attempts, 0);
      }
    });
  }
}

test('B: n=p remains accepted by the sequential API and n>p is rejected before consuming bytes', () => {
  const p = V.impossible.p;
  const result = GF.sequentialNormals(p, 2, p, GF.makeDetRng());
  assert.equal(result.A.length, p);
  assert.ok(GF.check(result.A, p).ok);
  const rng = GF.makeDetRng();
  assert.throws(() => GF.sequentialNormals(V.impossible.p, V.impossible.k, V.impossible.n, rng), RangeError);
  assert.equal(rng.count(), 0);
  assert.match(V.impossible.note, /n≤p/);
});

test('B: field and Uint32 rejection sampling, exact boundary, little endian, and rejection cap', () => {
  for (const p of [7, 11, 13]) {
    const limit = 256 - (256 % p);
    const rng = byteSequence([255, limit, limit - 1]);
    assert.equal(GF.randField(p, rng), (limit - 1) % p);
    assert.equal(rng.count(), 3);
  }
  const size = V.representativeCount['13-5'];
  const limit = 2 ** 32 - (2 ** 32 % size);
  const bytesOf = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
  const rng = byteSequence([...bytesOf(limit), ...bytesOf(limit - 1)]);
  assert.equal(GF.randIndex(size, rng), (limit - 1) % size);
  assert.equal(rng.count(), 8);
  const endian = byteSequence([1, 2, 3, 4]);
  assert.equal(GF.randIndex(2 ** 32, endian), 0x04030201);
  let rejectedBytes = 0;
  assert.throws(() => GF.randIndex(3, count => {
    rejectedBytes += count;
    return new Uint8Array(count).fill(255);
  }), /rejection limit/);
  assert.equal(rejectedBytes, 64 * 4);
});

test('B: p=13 k=5 n=8 generation completes in under one second', t => {
  const expected = V.sequential.find(row => row.p === 13 && row.k === 5 && row.n === 8);
  const started = performance.now();
  const result = GF.makeShares(expected.p, expected.k, expected.n, expected.s, GF.makeDetRng());
  const elapsed = performance.now() - started;
  t.diagnostic('generation ' + elapsed.toFixed(2) + ' ms, attempts=' + result.attempts);
  assert.deepEqual(result.A, expected.A);
  assert.ok(elapsed < 1000, 'generation took ' + elapsed.toFixed(2) + ' ms');
});

test('B: check tables preserve every subset and separate point recovery from secrecy', () => {
  for (const key of ['default_k2', 'default_k3', 'default_k4', 'default_k5']) {
    const D = V[key];
    const k = D.X.length;
    const rows = GF.checkRows(D.A, D.p);
    assert.equal(rows.length, GF.binom(D.A.length, k) + GF.binom(D.A.length, k - 1));
    assert.equal(rows.filter(row => row.kind === 'i').length, GF.binom(D.A.length, k));
    assert.ok(rows.every(row => row.ok && row.rank === k));
  }
  const L = V.leak_k3;
  assert.deepEqual(GF.check(L.A, L.p).badII, L.checkBadII);
  assert.deepEqual(GF.check(V.parallel_k2.A, V.parallel_k2.p).badI, V.parallel_k2.badI);
  assert.equal(GF.check(V.leak_k2.A, V.leak_k2.p).ok, false);
  const worst = V.sequential.find(row => row.p === 13 && row.k === 5);
  assert.equal(GF.checkRows(worst.A, worst.p).length, 126);
});

test('C: all k=2 lines have one point per secret candidate and match the complete fixture', () => {
  const D = V.default_k2;
  assert.deepEqual(D.A.map((row, i) => GF.linePoints(row, D.c[i], D.p)), D.lines);
  const counts = D.A.map((row, i) => GF.sCandidates([row], [D.c[i]], D.p));
  assert.equal(counts.every(row => row.every(count => count === 1)), D.singleEachCandidateOnce);
  assert.deepEqual(D.A.map((_, i) => Pitfalls.integerCandidates(D.A[i], D.cInt[i], D.p)), D.integerCandidates);
  assert.deepEqual(D.pointWhole.map((_, count) => Pitfalls.pointCandidates(D.A, D.c, D.p, count)), D.pointWhole);
  const raw = Pitfalls.integerShares(D.A, D.X);
  assert.deepEqual(raw.A, D.A);
  assert.deepEqual(raw.X, D.X);
  assert.deepEqual(raw.c, D.cInt);
  assert.deepEqual(raw.c.map(value => GF.mod(value, D.p)), D.c);
  assert.ok(raw.c.every((value, i) => value !== D.c[i]));
});

test('C: k=3 all ten two-share subsets have one point per slice, and all fixture slices match', () => {
  const D = V.default_k3;
  for (const T of GF.combinations(D.A.length, 2)) {
    assert.deepEqual(GF.sCandidates(subset(D.A, T), subset(D.c, T), D.p), new Array(D.p).fill(1));
  }
  assert.deepEqual(Array.from({ length: D.p }, (_, s) => GF.slicePoints(D.A.slice(0, 2), D.c.slice(0, 2), D.p, s)), D.slices12);
  assert.deepEqual(Array.from({ length: D.p }, (_, s) => GF.slicePoints(D.A.slice(0, 3), D.c.slice(0, 3), D.p, s)), D.slices123);
  assert.deepEqual(Pitfalls.integerShares(D.A, D.X).c, D.cInt);
  assert.deepEqual(D.pointWhole.map((_, count) => Pitfalls.pointCandidates(D.A, D.c, D.p, count)), D.pointWhole);
});

test('C: leaking and coincident configurations retain exactly the reference candidates', () => {
  for (const key of ['leak_k2', 'leak_k3', 'parallel_k2']) {
    const D = V[key];
    assert.deepEqual(GF.sCandidates(D.A, D.c, D.p), D.sCandidates);
    const points = GF.solutionPoints(D.A, D.c, D.p);
    assert.equal(points.length, D.sCandidates.reduce((sum, count) => sum + count, 0));
    for (const point of points) assert.ok(D.A.every((row, i) => GF.dot(row, point, D.p) === D.c[i]));
  }
  const L = V.leak_k3;
  assert.deepEqual(Array.from({ length: L.p }, (_, s) => GF.slicePoints(L.A, L.c, L.p, s).length), L.sliceCounts);
  const onePlane = [[4, 0, 0]];
  assert.equal(GF.slicePoints(onePlane, [7], 13, 5).length, 13 ** 2);
  assert.equal(GF.slicePoints(onePlane, [7], 13, 4).length, 0);
});

test('C: nullspace counting handles zero selection and avoids enumerating a large space', () => {
  for (const p of [7, 11, 13]) {
    for (let k = 2; k <= 5; k++) {
      const space = GF.solutionSpace([], [], p, k);
      assert.equal(space.count, p ** k);
      assert.equal(space.basis.length, k);
      assert.deepEqual(GF.sCandidates([], [], p, k), new Array(p).fill(p ** (k - 1)));
    }
  }
  assert.throws(() => GF.solutionPoints([], [], 13, 5), /too many points/);
  const D = V.default_k5;
  const points = GF.solutionPoints(D.A.slice(0, 4), D.c.slice(0, 4), D.p);
  assert.equal(points.length, D.p);
  assert.deepEqual(points.map(point => point[0]), Array.from({ length: D.p }, (_, i) => i));
});

test('D: Shamir k=2 all thirteen points and five equations match', () => {
  const S = V.shamir_k2;
  assert.deepEqual(GF.vandermonde(S.p, S.X.length, S.A.length), S.A);
  assert.deepEqual(S.A.map(row => GF.dot(row, S.X, S.p)), S.c);
  assert.deepEqual(GF.linePoints(S.A[0], S.c[0], S.p), S.line1);
  assert.deepEqual(GF.solve(S.A, S.c, S.p), S.X);
});

test('D: Shamir k=3 correspondence, zero coefficients, and nonzero-coordinate restriction', () => {
  const S = V.shamir;
  assert.deepEqual(GF.vandermonde(S.p, S.X.length, S.A.length), S.A);
  assert.deepEqual(S.A.map(row => GF.dot(row, S.X, S.p)), S.c);
  assert.deepEqual(GF.solve(S.A, S.c, S.p), S.X);
  const points = GF.solutionPoints(S.A.slice(0, 2), S.c.slice(0, 2), S.p);
  assert.deepEqual(points, S.line12);
  assert.deepEqual(points.filter(point => point[2] === 0), S.zeroTop);
  for (const point of points) {
    for (let i = 0; i < 2; i++) {
      const x = i + 1;
      assert.equal(GF.mod(point[0] + point[1] * x + point[2] * x * x, S.p), S.c[i]);
    }
  }
  const restricted = Pitfalls.nonzeroCandidates(S.A.slice(0, 2), S.c.slice(0, 2), S.p);
  assert.deepEqual(restricted, S.line12.filter(point => point.slice(1).every(value => value !== 0)));
  assert.equal(restricted.length, 11);
  assert.deepEqual(points.filter(point => !restricted.some(candidate => candidate[0] === point[0])).map(point => point[0]), [1, 12]);
});

test('D: unprotected point, integer, narrow-randomness, and unchecked-normal models', () => {
  const D = V.default_k2;
  for (let count = 1; count <= 2; count++) {
    const whole = Pitfalls.restoreWholePoint(D.A.slice(0, count), D.c.slice(0, count), D.p);
    assert.equal(whole.count, D.pointWhole[count]);
    assert.deepEqual(whole.point, count === 2 ? D.X : null);
  }
  const narrow = Pitfalls.narrowCandidates([D.A[0]], [D.c[0]], D.p);
  assert.deepEqual(narrow, D.lines[0].filter(point => point[1] <= 3));
  assert.equal(narrow.length, 4);
  const generated = Pitfalls.narrowShares(D.A, D.p, D.X[0], seededBytes(126));
  assert.ok(generated.X[1] >= 0 && generated.X[1] <= 3);
  assert.deepEqual(generated.c, generated.A.map(row => GF.dot(row, generated.X, generated.p)));
  const zeroRng = count => new Uint8Array(count);
  const unchecked = Pitfalls.uncheckedShares(D.p, 2, D.A.length, D.X[0], zeroRng);
  assert.equal(GF.check(unchecked.A, unchecked.p).ok, false);
  assert.deepEqual(unchecked.c, new Array(D.A.length).fill(0));
  const P = V.parallel_k2;
  assert.deepEqual(Pitfalls.cramerUnchecked(P.A, P.c, P.p), [0, 0]);
  assert.equal(GF.solve(P.A, P.c, P.p), null);
  const arbitrary = Pitfalls.freeVariablesZero([D.A[0]], [D.c[0]], D.p);
  assert.equal(GF.dot(D.A[0], arbitrary, D.p), D.c[0]);
  assert.equal(arbitrary[1], 0);
  assert.notDeepEqual(arbitrary, D.X);
});

test('D: exact unchecked-generator pass rates are derived from representative counts', () => {
  const k2 = V.sequential.find(row => row.p === 13 && row.k === 2 && row.n === 4);
  const k3 = V.sequential.find(row => row.p === 11 && row.k === 3 && row.n === 5);
  for (const D of [k2, k3]) {
    const product = D.candidateCounts.reduce((total, count) => total * count, 1);
    const rate = product * (D.p - 1) ** D.n / D.p ** (D.k * D.n);
    assert.ok(Math.abs(rate - V.passRate[[D.p, D.k, D.n].join('-')]) < 1e-14);
  }
});

test('E: altered right-hand side reproduces every pair and distinguishes detection from identification', () => {
  const D = V.default_k2;
  const T = V.tamper_k2;
  const c = D.c.slice();
  assert.equal(c[T.changed.share - 1], T.changed.from);
  c[T.changed.share - 1] = T.changed.to;
  for (const pair of T.pairs) {
    const indices = pair.T.map(i => i - 1);
    assert.deepEqual(GF.solve(subset(D.A, indices), subset(c, indices), D.p), pair.X);
  }
  const pair = GF.reconstruction(D.A.slice(0, 2), c.slice(0, 2), D.p);
  assert.deepEqual(pair.X, T.pairs.find(row => row.T.join(',') === '1,2').X);
  assert.equal(pair.allAgree, true);
  assert.deepEqual(pair.suspects, []);
  const triple = GF.reconstruction(D.A.slice(0, 3), c.slice(0, 3), D.p);
  assert.equal(triple.allAgree, false);
  assert.equal(triple.X, null);
  assert.deepEqual(triple.suspects, []);
  const four = GF.reconstruction(D.A, c, D.p);
  assert.equal(four.allAgree, false);
  assert.deepEqual(four.suspects, [T.changed.share - 1]);
  assert.deepEqual(four.groups[0].X, D.X);
  assert.deepEqual(four.groups[0].support, [0, 2, 3]);
  assert.equal(four.groups[0].count, 3);
  assert.deepEqual(Pitfalls.restoreFirstK(D.A, c, D.p), pair.X);
  assert.equal(GF.solve(D.A, c, D.p), null);
});

test('E: every delta and both inverse coefficients match the tamper linearity fixture', () => {
  const L = V.tamper_linearity;
  const X = GF.solve(L.A, L.c, L.p);
  const u = L.c.map((_, index) => {
    const rhs = L.c.slice();
    rhs[index] = GF.mod(rhs[index] + 1, L.p);
    return GF.mod(GF.solve(L.A, rhs, L.p)[0] - X[0], L.p);
  });
  assert.deepEqual(u, L.u);
  const byDelta = Array.from({ length: L.p }, (_, delta) => {
    const rhs = L.c.slice();
    rhs[L.shiftedShare - 1] = GF.mod(rhs[L.shiftedShare - 1] + delta, L.p);
    const secret = GF.solve(L.A, rhs, L.p)[0];
    assert.equal(secret, GF.mod(X[0] + u[L.shiftedShare - 1] * delta, L.p));
    return secret;
  });
  assert.deepEqual(byDelta, L.sByDelta);
  assert.equal(new Set(byDelta).size, L.p);
});

test('A/B: malformed inputs fail explicitly without consuming randomness', () => {
  const rng = GF.makeDetRng();
  for (const action of [
    () => GF.inv(1, 9), () => GF.mod(NaN, 13), () => GF.dot([1], [1, 2], 13),
    () => GF.rref([[1], [2, 3]], 13), () => GF.solve([[1, 2]], [], 13),
    () => GF.solve([[1, Infinity]], [0], 13), () => GF.solutionSpace([], [], 13),
    () => GF.representatives(13, 6), () => GF.representatives(13, 1.5),
    () => GF.makeShares(13, 1, 4, 5, rng), () => GF.makeShares(13, 3, 2, 5, rng),
    () => GF.makeShares(13, 2, 4, -1, rng), () => GF.makeShares(13, 2, 4, 13, rng),
    () => GF.makeShares(13, 2, 4, 5, rng, 'unknown'),
    () => GF.sequentialNormals(13, 2, 4, rng, 0), () => GF.sequentialNormals(13, 2, 4, rng, 1001),
    () => GF.vandermonde(7, 2, 7), () => GF.randIndex(0, rng), () => GF.randIndex(1.5, rng),
    () => GF.randIndex(2 ** 32 + 1, rng), () => GF.slicePoints([[1, 2, 3]], [0], 13, 13),
    () => GF.solutionPoints([], [], 13, 2, 0)
  ]) assert.throws(action);
  assert.equal(rng.count(), 0);
  assert.throws(() => GF.randField(13, () => [0]), TypeError);
  assert.throws(() => GF.randIndex(10, () => new Uint8Array(3)), TypeError);
  assert.throws(() => GF.randField(13, null), TypeError);
});

test('A/B: normal selection is independent of the secret and coordinate draws allow zero', () => {
  const example = V.sequential.find(row => row.X.slice(1).includes(0));
  const left = GF.makeShares(example.p, example.k, example.n, 0, GF.makeDetRng());
  const right = GF.makeShares(example.p, example.k, example.n, example.p - 1, GF.makeDetRng());
  assert.deepEqual(left.A, right.A);
  assert.deepEqual(left.X.slice(1), right.X.slice(1));
  assert.ok(left.X.slice(1).includes(0));
  assert.equal(left.attempts, right.attempts);
});

test('F: UMD browser exports exist and the core has no dependency on unprotected models', () => {
  const core = readFileSync(join(__dirname, '../gf-core.js'), 'utf8');
  const pitfalls = readFileSync(join(__dirname, '../pitfalls.js'), 'utf8');
  assert.doesNotMatch(core, /pitfalls|BlakleyPitfalls|document|window|localStorage|Math\.random/);
  const context = vm.createContext({});
  vm.runInContext(core, context);
  vm.runInContext(pitfalls, context);
  assert.equal(typeof context.BlakleyGF.solve, 'function');
  assert.equal(typeof context.BlakleyGF.sequentialNormalAttempts, 'function');
  assert.equal(typeof context.BlakleyPitfalls.cramerUnchecked, 'function');
  const D = V.default_k2;
  assert.equal(JSON.stringify(context.BlakleyGF.solve(D.A, D.c, D.p)), JSON.stringify(D.X));
});

test('fixtures: every authoritative top-level vector group is covered without omitted groups', () => {
  assert.deepEqual(Object.keys(V).sort(), [
    'detRng_first16', 'representativeCount', 'default_k2', 'tamper_k2', 'default_k3',
    'leak_k3', 'leak_k2', 'parallel_k2', 'shamir', 'sequential', 'default_k4', 'default_k5',
    'shamir_k2', 'tamper_linearity', 'passRate', 'impossible'
  ].sort());
});
test('A/B/C: large safe-integer representatives preserve field results before multiplication', () => {
  for (const key of ['default_k2', 'shamir']) {
    const D = V[key];
    const p = D.p;
    const k = D.X.length;
    const offset = Math.floor((Number.MAX_SAFE_INTEGER - p) / p) * p;
    assert.equal(offset % p, 0);
    const smallA = GF.vandermonde(p, k, D.A.length);
    const smallC = smallA.map(row => GF.dot(row, D.X, p));
    for (const sign of [-1, 1]) {
      const largeA = smallA.map(row => row.map(value => value + sign * offset));
      const largeC = smallC.map(value => value + sign * offset);
      assert.ok(largeA.flat().every(Number.isSafeInteger));
      assert.ok(largeC.every(Number.isSafeInteger));
      assert.deepEqual(largeA.map(row => GF.dot(row, D.X, p)), smallC);
      assert.deepEqual(GF.check(largeA, p), GF.check(smallA, p));
      const rng = byteSequence(D.X.slice(1));
      const generated = GF.completeShares(p, k, smallA.length, D.X[0], largeA, rng);
      assert.deepEqual(generated.X, D.X);
      assert.deepEqual(generated.c, smallC);
      assert.deepEqual(GF.reconstruction(largeA, largeC, p), GF.reconstruction(smallA, smallC, p));
      if (k === 3) {
        for (let s = 0; s < p; s++) {
          const expected = GF.slicePoints(smallA.slice(0, 2), smallC.slice(0, 2), p, s);
          assert.deepEqual(GF.slicePoints(largeA.slice(0, 2), largeC.slice(0, 2), p, s), expected);
        }
      }
    }
  }
});