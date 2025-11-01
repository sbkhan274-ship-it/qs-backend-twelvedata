require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());
app.use(cors());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const TWELVE_KEY = process.env.TWELVE_API_KEY;
if(!TWELVE_KEY){
  console.warn('Warning: TWELVE_API_KEY not set in environment. Set it before deploying.');
}

const cache = {};
const CACHE_TTL = 5 * 1000;

function setCache(key, data){
  cache[key] = { ts: Date.now(), data };
}
function getCache(key){
  const v = cache[key];
  if(!v) return null;
  if(Date.now() - v.ts > CACHE_TTL) { delete cache[key]; return null; }
  return v.data;
}

async function fetchFromTwelve(symbol, interval='1min', outputsize=100){
  const base = 'https://api.twelvedata.com/time_series';
  const params = new URLSearchParams({
    symbol: symbol.replace('/',''),
    interval,
    outputsize: String(outputsize),
    apikey: TWELVE_KEY,
    format: 'JSON'
  });
  const url = `${base}?${params.toString()}`;
  const res = await fetch(url, { timeout: 10000 });
  if(!res.ok) throw new Error(`TwelveData fetch failed: ${res.status}`);
  const json = await res.json();
  if(json && json.status === 'error') throw new Error(json.message || 'TwelveData error');
  return json;
}

function formatCandlesFromTwelve(twResp){
  if(!twResp) return null;
  const arr = twResp.values || [];
  const mapped = arr.map(v => ({
    open: parseFloat(v.open),
    high: parseFloat(v.high),
    low: parseFloat(v.low),
    close: parseFloat(v.close),
    datetime: v.datetime || v.timestamp
  })).reverse();
  return mapped;
}

app.get('/api/candles', async (req, res) => {
  try{
    const symbol = (req.query.symbol || 'EURUSD').toString();
    const interval = (req.query.interval || '1min').toString();
    const limit = parseInt(req.query.limit || '100', 10);

    const cacheKey = `${symbol}|${interval}|${limit}`;
    const cached = getCache(cacheKey);
    if(cached) return res.json({ candles: cached });

    const tw = await fetchFromTwelve(symbol, interval, limit);
    const candles = formatCandlesFromTwelve(tw);
    if(!candles || candles.length === 0) return res.status(502).json({ error: 'No candles from provider' });

    const trimmed = candles.slice(-limit);

    setCache(cacheKey, trimmed);
    return res.json({ candles: trimmed });
  }catch(err){
    console.error('candles error', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Failed to fetch candles', detail: err.message || String(err) });
  }
});

app.get('/api/simulateOutcome', (req, res) => {
  const conf = parseInt(req.query.conf || '70', 10) || 70;
  const seeded = (Date.now() + conf*13) % 100;
  const result = seeded <= conf ? 'WIN' : 'LOSS';
  return res.json({ result });
});

app.post('/webhook/signal', (req, res) => {
  console.log('Received webhook:', req.body);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`QS backend listening on port ${PORT}`);
});
