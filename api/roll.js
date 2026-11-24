'use strict';

const crypto = require('node:crypto');
const { roll, formatMessage, MAX } = require('../lib/badges');

// GET /api/roll  ->  plain text, e.g.
// "rolled 4,812,306 for 1,400 EP [UNCOMMON]. Their number contained prime number, and 3 more."
// (StreamElements puts $(sender) in front of it.)
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    let n = crypto.randomInt(0, MAX + 1); // 0 to 10,000,000 inclusive

    // Optional testing hook: set ALLOW_TEST_ROLL=1 in Vercel, then call /api/roll?n=69420
    const forced = req.query && req.query.n;
    if (process.env.ALLOW_TEST_ROLL === '1' && /^\d+$/.test(String(forced)) && Number(forced) <= MAX) {
      n = Number(forced);
    }

    res.status(200).send(formatMessage(roll(n)));
  } catch (err) {
    console.error(err);
    res.status(200).send('tried to roll but the RNG machine jammed. Try again!');
  }
};
