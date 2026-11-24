'use strict';
// node scripts/test.js 69420 8008 1234567   -> show the result for specific numbers
// node scripts/test.js --sim 200000         -> simulate rolls, print tier odds + average EP
const { roll, formatMessage, MAX, TIER_ORDER } = require('../lib/badges');
const args = process.argv.slice(2);

if (args[0] === '--sim') {
  const N = Number(args[1]) || 100000;
  const tiers = {}; let totalEp = 0, none = 0, longest = 0;
  for (let i = 0; i < N; i++) {
    const r = roll(Math.floor(Math.random() * (MAX + 1)));
    totalEp += r.ep;
    if (!r.tier) none++; else tiers[r.tier] = (tiers[r.tier] || 0) + 1;
    longest = Math.max(longest, formatMessage(r).length);
  }
  console.log(`rolls: ${N}   avg EP: ${Math.round(totalEp / N).toLocaleString()}   longest message: ${longest} chars`);
  console.log(`no badge: ${(100 * none / N).toFixed(2)}%`);
  for (const t of [...TIER_ORDER].reverse()) console.log(`${t.padEnd(9)} (best badge): ${(100 * (tiers[t] || 0) / N).toFixed(3)}%`);
} else {
  const list = args.length ? args.map(Number) : Array.from({ length: 8 }, () => Math.floor(Math.random() * (MAX + 1)));
  for (const n of list) console.log(`$(sender) ${formatMessage(roll(n))}\n`);
}
