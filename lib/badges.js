'use strict';

// ============================================================================
//  RNGdle-style badge engine for a 0 - 10,000,000 roll.
//  Every badge: { name, ep, tier, test(ctx), group? }
//  `group` = a "ladder": if several badges in the same group match, only the
//  one with the highest EP is kept (e.g. ends in 00 / 000 / 0000 / 00000).
// ============================================================================

const MAX = 10_000_000;
const TIER_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'ANOMALY', 'MYTHIC', 'UNHEARD'];
const COLOSSAL_MIN = MAX - MAX / 1000; // top 0.1% of the range (original game: >999,000 of 1,000,000)

// ---------- precomputed number sets ----------
const powerSets = {};
for (let k = 2; k <= 19; k++) {
  const set = new Set();
  for (let r = 2; r ** k <= MAX; r++) set.add(r ** k);
  powerSets[k] = set;
}
const powersOf = (b) => {
  const set = new Set();
  for (let v = b * b; v <= MAX; v *= b) set.add(v);
  return set;
};
const POW2 = powersOf(2), POW3 = powersOf(3), POW5 = powersOf(5), POW7 = powersOf(7);
const SELF_POW = new Set();
for (let n = 2; n ** n <= MAX; n++) SELF_POW.add(n ** n);
const FACT = new Set();
for (let n = 2, f = 1; f * n <= MAX; n++) { f *= n; if (n >= 3) FACT.add(f); }
const FIB = new Set([1]);
for (let a = 1, b = 2; b <= MAX; [a, b] = [b, a + b]) FIB.add(b);
const PRONIC = new Set();
for (let k = 1; k * (k + 1) <= MAX; k++) PRONIC.add(k * (k + 1));

// "N consecutive numbers" (at least one of them has 2+ digits), written back to back: 78910, 891011 ...
const seqOrdered = { 2: new Set(), 3: new Set(), 4: new Set() };
const seqBySig = { 3: new Map(), 4: new Map() };
for (let k = 2; k <= 4; k++) {
  for (let s = 0; s <= 9999; s++) {
    if (s + k - 1 < 10) continue;
    const toks = Array.from({ length: k }, (_, i) => String(s + i));
    const str = toks.join('');
    if (str.length > 8) continue;
    seqOrdered[k].add(str);
    if (k >= 3) {
      const sig = [...str].sort().join('');
      if (!seqBySig[k].has(sig)) seqBySig[k].set(sig, []);
      seqBySig[k].get(sig).push(toks);
    }
  }
}

// ---------- helpers ----------
const ASC = '0123456789', DESC = '9876543210';

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function substrings(s, minLen, maxLen) {
  const out = [];
  for (let len = minLen; len <= Math.min(maxLen, s.length); len++)
    for (let i = 0; i + len <= s.length; i++) out.push(s.slice(i, i + len));
  return out;
}

const hasDigitSeq = (s, len) => {
  for (let i = 0; i + len <= s.length; i++) {
    const w = s.slice(i, i + len);
    if (ASC.includes(w) || DESC.includes(w)) return true;
  }
  return false;
};

// split s into >=3 terms of 1-3 digits (no leading zeros) and test each split
function termSplits(s, cb) {
  const rec = (pos, terms) => {
    if (pos === s.length) return terms.length >= 3 && cb(terms);
    for (let len = 1; len <= 3 && pos + len <= s.length; len++) {
      const t = s.slice(pos, pos + len);
      if (len > 1 && t[0] === '0') continue;
      terms.push(Number(t));
      const hit = rec(pos + len, terms);
      terms.pop();
      if (hit) return true;
    }
    return false;
  };
  return rec(0, []);
}
const allEqual = (a) => a.every((x) => x === a[0]);
const isGeometric = (t) => !allEqual(t) && t.every((x) => x > 0) && t.every((x, i) => i === 0 || i === t.length - 1 || x * x === t[i - 1] * t[i + 1]);
const isArithmetic = (t) => !allEqual(t) && t.every((x, i) => i < 2 || x - t[i - 1] === t[1] - t[0]);

function isEquation(s) {
  const val = (t) => (t.length > 1 && t[0] === '0' ? null : Number(t));
  const ops = (a, b) => [a + b, a - b, a * b, b !== 0 && a % b === 0 ? a / b : NaN];
  for (let i = 1; i < s.length - 1; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const A = val(s.slice(0, i)), B = val(s.slice(i, j)), C = val(s.slice(j));
      if (A === null || B === null || C === null) continue;
      if (ops(A, B).includes(C)) return true; // A op B = C
      if (ops(B, C).includes(A)) return true; // A = B op C
    }
  }
  return false;
}

function isBalanced(d) {
  const L = d.length;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  for (let a = 1; a <= 3; a++) {
    const b = L - a;
    if (b >= 1 && b <= 3 && sum(d.slice(0, a)) === sum(d.slice(a))) return true;
  }
  return false;
}

function hasRhyme(s) {
  for (let len = 2; len <= Math.floor(s.length / 2); len++)
    for (let i = 0; i + len <= s.length; i++) {
      const sub = s.slice(i, i + len);
      if (s.indexOf(sub, i + len) !== -1) return true;
    }
  return false;
}

function isSortedSequence(sub) {
  const d = [...sub].map(Number).sort((a, b) => a - b);
  return d.every((x, i) => i === 0 || x === d[i - 1] + 1);
}

const ROT = { 0: '0', 1: '1', 6: '9', 8: '8', 9: '6' };
const isStrobo = (s) => s.length >= 2 && [...s].every((c) => c in ROT) && [...s].reverse().map((c) => ROT[c]).join('') === s;
const isPalin = (s) => s.length >= 2 && s === [...s].reverse().join('');

function containsConsecutive(s, k) {
  return substrings(s, 2, s.length - 1).some((sub) => seqOrdered[k].has(sub)) || false;
}

function canArrange(sub, toks) {
  const rec = (pos, rest) => {
    if (pos === sub.length) return rest.length === 0;
    for (let i = 0; i < rest.length; i++) {
      if (sub.startsWith(rest[i], pos) && rec(pos + rest[i].length, rest.filter((_, j) => j !== i))) return true;
    }
    return false;
  };
  return rec(0, toks);
}
function containsScrambled(s, k) {
  for (const sub of substrings(s, 3, s.length)) {
    const cands = seqBySig[k].get([...sub].sort().join(''));
    if (!cands) continue;
    for (const toks of cands) if (sub !== toks.join('') && canArrange(sub, toks)) return true;
  }
  return false;
}

function hasNearbyConsecutive(s) {
  const L = s.length;
  const positions = (needle) => {
    const out = [];
    for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) out.push(i);
    return out;
  };
  for (let n = 9; n <= 9999; n++) {
    const a = String(n), b = String(n + 1);
    if (a.length + b.length + 1 > L || !s.includes(a) || !s.includes(b)) continue;
    for (const i of positions(a))
      for (const j of positions(b))
        if (j >= i + a.length + 1 || i >= j + b.length + 1) return true;
  }
  return false;
}

// ---------- roll context ----------
function makeCtx(n) {
  const s = String(n);
  const d = [...s].map(Number);
  const L = d.length;
  const counts = Array(10).fill(0);
  d.forEach((x) => counts[x]++);
  const runs = [];
  d.forEach((x, i) => {
    const last = runs[runs.length - 1];
    if (last && last.d === x) last.len++;
    else runs.push({ d: x, len: 1, start: i });
  });
  const diffs = d.slice(1).map((x, i) => x - d[i]);
  const sum = d.reduce((a, b) => a + b, 0);
  const product = d.reduce((a, b) => a * b, 1);
  return {
    n, s, d, L, counts, runs, diffs,
    sum, product,
    uniq: counts.filter((c) => c > 0).length,
    maxCount: Math.max(...counts),
    maxRun: Math.max(...runs.map((r) => r.len)),
    pairCount: counts.filter((c) => c >= 2).length,
    signs: diffs.filter((x) => x !== 0).map((x) => (x > 0 ? '+' : '-')).join(''),
    hasZeroDiff: diffs.some((x) => x === 0),
    // framed run: a run of identical digits with a different digit on BOTH sides, and no other digit repeats
    framed: runs.filter((r) => r.start > 0 && r.start + r.len < L && counts.every((x, dgt) => dgt === r.d || x <= 1)),
    framedLoose: runs.filter((r) => r.start > 0 && r.start + r.len < L),
  };
}

// ---------- badge table ----------
const BADGES = [];
const add = (name, ep, tier, test, group) => BADGES.push({ name, ep, tier, test, group });
const contains = (name, ep, tier, str, group) => add(name, ep, tier, (c) => c.s.includes(str), group);
const endsIn = (name, ep, tier, str, group) => add(name, ep, tier, (c) => c.s.endsWith(str), group);
const exact = (name, ep, tier, list, group) => { const set = new Set(list); add(name, ep, tier, (c) => set.has(c.n), group); };
const ord = (k) => (k === 2 ? '2nd' : k === 3 ? '3rd' : `${k}th`);
const power = (k, ep, tier) => add(`${ord(k)} power`, ep, tier, (c) => powerSets[k].has(c.n));
const digitCount = (name, ep, tier, len) => add(name, ep, tier, (c) => c.L === len);
const eachDigit = (c, f) => c.d.every(f);

// ---- UNHEARD ----
add('the fabled ten million', 100000100, 'UNHEARD', (c) => c.n === MAX);
exact('exact number', 100000100, 'UNHEARD', [42, 67, 69, 86, 101, 365, 404, 420, 666, 777, 911, 1337, 1984, 7734, 17776, 80085, 86400, 365365, 420420, 424242, 666666, 676767, 696969, 777777, 911911]);
add('0/1/2/3/4/5/6/7/8/9', 100000100, 'UNHEARD', (c) => c.L === 1);
exact('funny number', 50000050, 'UNHEARD', [69420, 42069]);
exact('exact boob', 50000050, 'UNHEARD', [58008, 8008]);
exact('always', 50000050, 'UNHEARD', [247365, 365247]);
[13, 17, 19].forEach((k) => power(k, 33333367, 'UNHEARD'));
exact('tau', 33333367, 'UNHEARD', [6283, 62831, 628318], 'tau');
exact('golden ratio', 33333367, 'UNHEARD', [1618, 16180, 161803]);

// ---- MYTHIC ----
exact('pi', 25000025, 'MYTHIC', [314, 3141, 31415, 314159], 'pi');
exact("euler's number", 25000025, 'MYTHIC', [271, 2718, 27182, 271828], 'e');
add('4 consecutive numbers', 25000025, 'MYTHIC', (c) => seqOrdered[4].has(c.s), 'consec');
power(10, 25000025, 'MYTHIC');
power(11, 25000025, 'MYTHIC');
power(9, 20000020, 'MYTHIC');
power(8, 16666683, 'MYTHIC');
add('ouroboros', 14285729, 'MYTHIC', (c) => SELF_POW.has(c.n));
power(7, 12500013, 'MYTHIC');
add('power of seven', 12500013, 'MYTHIC', (c) => POW7.has(c.n));
add('sequence (6)', 11111122, 'MYTHIC', (c) => hasDigitSeq(c.s, 6), 'digitSeq');
add('power of five', 11111122, 'MYTHIC', (c) => POW5.has(c.n));
contains('hello', 11111122, 'MYTHIC', '07734');
add('factorial', 11111122, 'MYTHIC', (c) => FACT.has(c.n));
digitCount('single digit', 10000010, 'MYTHIC', 1);
endsIn('semi-eon', 10000010, 'MYTHIC', '50000', 'endsFifty');
endsIn('quint nine', 10000010, 'MYTHIC', '99999', 'endsNine');
endsIn('eon', 10000010, 'MYTHIC', '00000', 'endsZero');
contains('deep void (5)', 10000010, 'MYTHIC', '00000', 'void0');
add('contiguous sixes', 10000010, 'MYTHIC', (c) => c.maxRun >= 6, 'run');

// ---- ANOMALY ----
power(6, 9090918, 'ANOMALY');
add('power of three', 7692315, 'ANOMALY', (c) => POW3.has(c.n));
power(5, 6250006, 'ANOMALY');
contains('jackpot five', 5263163, 'ANOMALY', '77777', 'jackpot');
contains('58008', 5000005, 'ANOMALY', '58008');
contains('80085', 5000005, 'ANOMALY', '80085');
contains('tau slice (5)', 5000005, 'ANOMALY', '62831', 'tau');
contains('royal flush', 5000005, 'ANOMALY', '56789');
add('power of two', 5000005, 'ANOMALY', (c) => POW2.has(c.n));
contains('pi slice (5)', 5000005, 'ANOMALY', '31415', 'pi');
contains('e slice (5)', 5000005, 'ANOMALY', '27182', 'e');
add('fibonacci number', 3333337, 'ANOMALY', (c) => FIB.has(c.n));
add('cascade', 3333337, 'ANOMALY', (c) => c.L >= 2 && c.diffs.every((x) => x === 1));
power(4, 3125003, 'ANOMALY');
add('waterfall', 2857146, 'ANOMALY', (c) => c.L >= 2 && c.diffs.every((x) => x === -1));
add('4 consecutive numbers (contains)', 2631582, 'ANOMALY', (c) => containsConsecutive(c.s, 4), 'consec');
add('4 consecutive numbers (scrambled)', 2272730, 'ANOMALY', (c) => containsScrambled(c.s, 4), 'consecScr');
add('homogeneous', 2222224, 'ANOMALY', (c) => c.L >= 2 && c.uniq === 1);
add('funny numbers', 1666668, 'ANOMALY', (c) => c.s.includes('69') && c.s.includes('420'));
add('binary soul', 1538463, 'ANOMALY', (c) => c.L >= 2 && eachDigit(c, (x) => x <= 1));
add('straight flush', 1449277, 'ANOMALY', (c) => ['13579', '97531', '02468', '86420'].some((p) => c.s.includes(p)));
digitCount('two digits', 1111112, 'ANOMALY', 2);
add('spy number', 1030929, 'ANOMALY', (c) => c.L >= 2 && c.sum === c.product);
endsIn('semi-epoch', 1000001, 'ANOMALY', '5000', 'endsFifty');
endsIn('quad nine', 1000001, 'ANOMALY', '9999', 'endsNine');
endsIn('epoch', 1000001, 'ANOMALY', '0000', 'endsZero');

// ---- EPIC ----
power(3, 990100, 'EPIC');
add('even spacing', 862070, 'EPIC', (c) => c.L >= 3 && c.diffs[0] !== 0 && allEqual(c.diffs));
add('3 consecutive numbers', 555556, 'EPIC', (c) => seqOrdered[3].has(c.s), 'consec');
contains('deep void (4)', 552487, 'EPIC', '0000', 'void0');
add('contiguous fives', 552487, 'EPIC', (c) => c.maxRun >= 5, 'run');
add('strobogrammatic', 502513, 'EPIC', (c) => isStrobo(c.s));
add('straight', 454546, 'EPIC', (c) => hasDigitSeq(c.s, 5), 'digitSeq');
contains('jackpot four', 357143, 'EPIC', '7777', 'jackpot');
contains('6767', 334448, 'EPIC', '6767');
contains('very nice', 334448, 'EPIC', '6969');
contains('deeper meaning', 334448, 'EPIC', '4242');
contains('8008', 333334, 'EPIC', '8008');
contains('tau slice (4)', 333334, 'EPIC', '6283', 'tau');
contains('pi slice (4)', 333334, 'EPIC', '3141', 'pi');
contains('leet', 333334, 'EPIC', '1337');
contains('hell', 333334, 'EPIC', '7734');
contains('e slice (4)', 333334, 'EPIC', '2718', 'e');
contains('big brother', 333334, 'EPIC', '1984');
add('3 consecutive numbers (scrambled)', 277778, 'EPIC', (c) => containsScrambled(c.s, 3), 'consecScr');
add('zipper', 246914, 'EPIC', (c) => c.L >= 3 && c.uniq === 2 && c.d.every((x, i) => i < 2 || x === c.d[i - 2]));
add('ascension', 219298, 'EPIC', (c) => c.L >= 2 && c.diffs.every((x) => x > 0));
add('crescendo', 208334, 'EPIC', (c) => termSplits(c.s, isGeometric));
add('five of a kind', 198020, 'EPIC', (c) => c.maxCount >= 5, 'kind');
add('3 consecutive numbers (contains)', 157978, 'EPIC', (c) => containsConsecutive(c.s, 3), 'consec');
add('contiguous three pair', 154321, 'EPIC', (c) => c.runs.some((r, i) => i + 2 < c.runs.length && r.len >= 2 && c.runs[i + 1].len >= 2 && c.runs[i + 2].len >= 2), 'runPairs');
add('framed quad', 137174, 'EPIC', (c) => c.framed.some((r) => r.len === 4));
add('framed triple', 137174, 'EPIC', (c) => c.framed.some((r) => r.len === 3));
add('framed pair', 137174, 'EPIC', (c) => c.framed.some((r) => r.len === 2), 'framedPair');
add('decay', 119474, 'EPIC', (c) => c.L >= 2 && c.diffs.every((x) => x < 0));
digitCount('three digits', 111111, 'EPIC', 3);
add('echo', 100100, 'EPIC', (c) => c.L % 2 === 0 && c.L / 2 <= 3 && c.s.slice(0, c.L / 2) === c.s.slice(c.L / 2));
endsIn('triple nine', 100000, 'EPIC', '999', 'endsNine');
endsIn('semi-millennium', 100000, 'EPIC', '500', 'endsFifty');
add('pronic number', 100000, 'EPIC', (c) => PRONIC.has(c.n));
endsIn('millenium', 100000, 'EPIC', '000', 'endsZero');
add('colossal', 100000, 'EPIC', (c) => c.n > COLOSSAL_MIN);

// ---- RARE ----
power(2, 99900, 'RARE');
add('even spacing (absolute)', 90992, 'RARE', (c) => {
  if (c.L < 3 || c.diffs[0] === 0) return false;
  const a = Math.abs(c.diffs[0]);
  return c.diffs.every((x) => Math.abs(x) === a) && !allEqual(c.diffs);
});
add('firefly', 82237, 'RARE', (c) => {
  if (c.uniq !== 2) return false;
  const cs = c.counts.filter((x) => x > 0).sort((a, b) => a - b);
  return cs[0] === 1 && cs[1] >= 3;
});
add('2 consecutive numbers', 50505, 'RARE', (c) => seqOrdered[2].has(c.s), 'consec');
add('palindrome', 50025, 'RARE', (c) => isPalin(c.s));
contains('deep void (3)', 37023, 'RARE', '000', 'void0');
add('contiguous quads', 37023, 'RARE', (c) => c.maxRun >= 4, 'run');
add('turtle', 36049, 'RARE', (c) => c.L >= 2 && c.diffs.every((x) => Math.abs(x) <= 1));
contains('secret agent', 34614, 'RARE', '007');
add('heavy', 33300, 'RARE', (c) => c.sum >= 45);
add('contiguous full house', 30111, 'RARE', (c) => c.runs.some((r, i) => i + 1 < c.runs.length && ((r.len >= 3 && c.runs[i + 1].len >= 2) || (r.len >= 2 && c.runs[i + 1].len >= 3))));
contains('jackpot', 27027, 'RARE', '777', 'jackpot');
contains('devil', 27027, 'RARE', '666');
add('sequence (4)', 25907, 'RARE', (c) => hasDigitSeq(c.s, 4), 'digitSeq');
contains('orientation', 25132, 'RARE', '101');
contains('error 404', 25132, 'RARE', '404');
contains('pi slice (3)', 25006, 'RARE', '314', 'pi');
contains('emergency', 25006, 'RARE', '911');
contains('e slice (3)', 25006, 'RARE', '271', 'e');
contains('calendar', 25006, 'RARE', '365');
contains('botanist', 25006, 'RARE', '420');
add('divisible by 3', 24414, 'RARE', (c) => eachDigit(c, (x) => x % 3 === 0));
add('scramble', 22722, 'RARE', (c) => c.L >= 4 && c.uniq === c.L && isSortedSequence(c.s), 'scramble');
add('duality', 21654, 'RARE', (c) => c.uniq === 2);
add('steps', 20202, 'RARE', (c) => c.L >= 2 && c.diffs.every((x) => x >= 0));
add('metronome', 17784, 'RARE', (c) => termSplits(c.s, isArithmetic));
add('framed double', 15242, 'RARE', (c) => c.framedLoose.filter((r) => r.len === 2).length >= 2);
add('slopes', 12582, 'RARE', (c) => c.L >= 2 && c.diffs.every((x) => x <= 0));
add('paired bookends', 11122, 'RARE', (c) => c.L >= 4 && c.d[0] === c.d[1] && c.d[c.L - 1] === c.d[c.L - 2] && c.d[0] !== c.d[c.L - 1]);
digitCount('four digits', 11111, 'RARE', 4);
add('three pair', 10288, 'RARE', (c) => c.pairCount >= 3, 'pairs');
add('bookends', 10010, 'RARE', (c) => c.L >= 4 && c.s.slice(0, 2) === c.s.slice(-2));
add('mirror bookends', 10010, 'RARE', (c) => c.L >= 4 && c.s.slice(0, 2) === [...c.s.slice(-2)].reverse().join(''));
endsIn('three-quarter century', 10000, 'RARE', '75', 'endsFive');
endsIn('semi-century', 10000, 'RARE', '50', 'endsFifty');
endsIn('quarter-century', 10000, 'RARE', '25', 'endsFive');
endsIn('double nine', 10000, 'RARE', '99', 'endsNine');
endsIn('century', 10000, 'RARE', '00', 'endsZero');

// ---- UNCOMMON ----
add('four of a kind', 8436, 'UNCOMMON', (c) => c.maxCount >= 4, 'kind');
add('equation', 7720, 'UNCOMMON', (c) => isEquation(c.s));
add('low ball', 6400, 'UNCOMMON', (c) => eachDigit(c, (x) => x <= 4));
add('mountain', 5885, 'UNCOMMON', (c) => c.L >= 3 && !c.hasZeroDiff && /^\++-+$/.test(c.signs), 'peak');
add('double hop', 5321, 'UNCOMMON', (c) => c.d.some((x, i) => i + 4 < c.L && x === c.d[i + 2] && x === c.d[i + 4]), 'hop');
add('high roller', 5120, 'UNCOMMON', (c) => eachDigit(c, (x) => x >= 5));
add('valley', 4199, 'UNCOMMON', (c) => c.L >= 3 && !c.hasZeroDiff && /^-+\++$/.test(c.signs), 'dip');
add('contiguous two pair', 3957, 'UNCOMMON', (c) => c.runs.some((r, i) => i + 1 < c.runs.length && r.len >= 2 && c.runs[i + 1].len >= 2), 'runPairs');
add('mini echo', 3704, 'UNCOMMON', (c) => /(\d\d)\1/.test(c.s));
add('flush', 2845, 'UNCOMMON', (c) => c.L >= 2 && (eachDigit(c, (x) => x % 2 === 0) || eachDigit(c, (x) => x % 2 === 1)));
add('alternator', 2845, 'UNCOMMON', (c) => c.L >= 2 && c.d.every((x, i) => i === 0 || x % 2 !== c.d[i - 1] % 2));
contains('deep void', 2784, 'UNCOMMON', '00', 'void0');
add('contiguous trips', 2784, 'UNCOMMON', (c) => c.maxRun >= 3, 'run');
add('feather', 2667, 'UNCOMMON', (c) => c.sum < 15);
add('blackjack', 2521, 'UNCOMMON', (c) => c.sum === 21);
add('full house', 2397, 'UNCOMMON', (c) => c.counts.some((a, i) => a >= 3 && c.counts.some((b, j) => j !== i && b >= 2)));
add('pocket mirror', 2124, 'UNCOMMON', (c) => substrings(c.s, 4, 5).some(isPalin));
add('snake eyes', 2121, 'UNCOMMON', (c) => c.counts[1] === 2 && c.pairCount === 1);
contains('six-seven', 2024, 'UNCOMMON', '67');
contains('nice', 2024, 'UNCOMMON', '69');
contains('meaning of life', 2024, 'UNCOMMON', '42');
contains('eighty-six', 2024, 'UNCOMMON', '86');
add('balanced', 1959, 'UNCOMMON', (c) => isBalanced(c.d));
add('rhyme', 1872, 'UNCOMMON', (c) => hasRhyme(c.s));
add('sequence (3)', 1716, 'UNCOMMON', (c) => hasDigitSeq(c.s, 3), 'digitSeq');
add('2 consecutive numbers (contains)', 1659, 'UNCOMMON', (c) => containsConsecutive(c.s, 2), 'consec');
add('2 consecutive numbers (nearby)', 1575, 'UNCOMMON', (c) => hasNearbyConsecutive(c.s), 'consecNear');
add('mesa', 1568, 'UNCOMMON', (c) => c.L >= 3 && /^\++-+$/.test(c.signs) && c.hasZeroDiff, 'peak');
add('prime number', 1274, 'UNCOMMON', (c) => isPrime(c.n));
add('trinity', 1265, 'UNCOMMON', (c) => c.uniq === 3);
add('dozen', 1200, 'UNCOMMON', (c) => c.n > 0 && c.n % 12 === 0);
add('canyon', 1184, 'UNCOMMON', (c) => c.L >= 3 && /^-+\++$/.test(c.signs) && c.hasZeroDiff, 'dip');
digitCount('five digits', 1111, 'UNCOMMON', 5);
add('eleven', 1100, 'UNCOMMON', (c) => c.n > 0 && c.n % 11 === 0);
add('harshad number', 1048, 'UNCOMMON', (c) => c.L >= 2 && c.sum > 0 && c.n % c.sum === 0);
endsIn('semi-clean', 1000, 'UNCOMMON', '5', 'endsFive');
add('equilibrium', 1000, 'UNCOMMON', (c) => c.L >= 2 && c.d[0] === c.d[c.L - 1]);
endsIn('clean', 1000, 'UNCOMMON', '0', 'endsZero');
// "sandwich" is marked [IMPOSSIBLE TO EARN] in the screenshot, so it is left out.

// ---- COMMON ----
add('hills', 733, 'COMMON', (c) => c.L >= 3 && !c.hasZeroDiff && /^(\+-)+\+?$|^(-\+)+-?$/.test(c.signs), 'alt');
add('three of a kind', 724, 'COMMON', (c) => c.maxCount >= 3, 'kind');
add('lucky seven (divisible)', 700, 'COMMON', (c) => c.n > 0 && c.n % 7 === 0);
add('heterogeneous', 593, 'COMMON', (c) => c.L >= 2 && c.uniq === c.L);
add('mini scramble', 579, 'COMMON', (c) => substrings(c.s, 3, 5).some((sub) => new Set(sub).size === sub.length && isSortedSequence(sub)), 'scramble');
add('gap one', 529, 'COMMON', (c) => c.L >= 2 && Math.abs(c.d[0] - c.d[c.L - 1]) === 1);
add('two pair', 377, 'COMMON', (c) => c.pairCount >= 2, 'pairs');
add('dunes', 364, 'COMMON', (c) => {
  if (c.L < 3 || c.signs.length < 2) return false;
  return !/\+\+|--/.test(c.signs);
}, 'alt');
add('hopscotch', 312, 'COMMON', (c) => c.d.some((x, i) => i + 2 < c.L && x === c.d[i + 2]), 'hop');
add('ghost (0)', 309, 'COMMON', (c) => c.counts[0] === 1);
add('quartet', 290, 'COMMON', (c) => c.uniq === 4);
[['oxygen (8)', 8], ['nitrogen (7)', 7], ['lithium (3)', 3], ['hydrogen (1)', 1], ['helium (2)', 2],
  ['fluorine (9)', 9], ['carbon (6)', 6], ['boron (5)', 5], ['beryllium (4)', 4]]
  .forEach(([name, dgt]) => add(name, 282, 'COMMON', (c) => c.counts[dgt] === 1));
add('grounded', 250, 'COMMON', (c) => c.L >= 2 && c.d[0] < c.d[c.L - 1]);
add('contiguous pair', 249, 'COMMON', (c) => c.maxRun >= 2, 'run');
contains('lucky seven', 213, 'COMMON', '7');
add('liftoff', 200, 'COMMON', (c) => c.L >= 2 && c.d[0] > c.d[c.L - 1]);
add('odd', 200, 'COMMON', (c) => c.n % 2 === 1);
add('even', 200, 'COMMON', (c) => c.n % 2 === 0);
add('void', 167, 'COMMON', (c) => c.counts[0] === 0);
add('neighbors', 161, 'COMMON', (c) => c.counts.some((x, i) => i < 9 && x > 0 && c.counts[i + 1] > 0));
add('pair', 120, 'COMMON', (c) => c.pairCount >= 1, 'pairs');
digitCount('six digits', 111, 'COMMON', 6);

// ---------- engine ----------
function roll(n) {
  const ctx = makeCtx(n);
  const hits = BADGES.filter((b) => b.test(ctx));

  // ladders: keep only the best badge of each group
  const bestByGroup = new Map();
  const kept = [];
  for (const b of hits) {
    if (!b.group) { kept.push(b); continue; }
    const cur = bestByGroup.get(b.group);
    if (!cur || b.ep > cur.ep) bestByGroup.set(b.group, b);
  }
  kept.push(...bestByGroup.values());
  kept.sort((a, b) => b.ep - a.ep || a.name.localeCompare(b.name));

  const ep = kept.reduce((sum, b) => sum + b.ep, 0);
  const tier = kept.length
    ? TIER_ORDER[Math.max(...kept.map((b) => TIER_ORDER.indexOf(b.tier)))]
    : null;
  return { n, ep, tier, badges: kept };
}

const fmt = (x) => x.toLocaleString('en-US');
const joinList = (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`);

// StreamElements chat messages are capped at 500 chars (and $(sender) is added in front)
function formatMessage(result, { maxBadges = 6, maxLength = 420 } = {}) {
  const head = `rolled ${fmt(result.n)} for ${fmt(result.ep)} EP${result.tier ? ` [${result.tier}]` : ''}.`;
  if (!result.badges.length) return `${head} Their number contained nothing special.`;
  const names = result.badges.map((b) => b.name);
  for (let shown = Math.min(maxBadges, names.length); shown >= 1; shown--) {
    const rest = names.length - shown;
    const list = rest > 0 ? [...names.slice(0, shown), `${rest} more`] : names.slice(0, shown);
    const msg = `${head} Their number contained: ${joinList(list)}.`;
    if (msg.length <= maxLength || shown === 1) return msg;
  }
}

module.exports = { roll, formatMessage, MAX, BADGES, TIER_ORDER };
