// ====== IMPORTS ======
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// ====== APP SETUP ======
const app = express();
app.use(express.json());
app.use(cors());

// Rate limiter (avoid spam)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ====== API KEY ======
const TWELVE_KEY = process.env.TWELVE_API_KEY || "f7c98b751b264bf9a8b7d47c57864f18";
if (!TWELVE_KEY) {
  console.warn("⚠️ Warning: TWELVE_API_KEY not set in environment. Using fallback key.");
}

// ====== CACHE ======
const cache = {};
const CACHE_TTL = 60 * 1000; // 1 minute cache

function setCache(key, data) {
  cache[key] = { ts: Date.now(), data };
}

function getCache(key) {
  const v = cache[key];
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL) {
    delete cache[key];
    return null;
  }
  return v.data;
}

// ====== FETCH FROM TWELVEDATA ======
async function fetchFromTwelve(symbol, interval = "1min", outputsize = 100) {
  const cleanSymbol = symbol.replaceAll("/", "").replace(/\s+/g, "").toUpperCase();
  const base = "https://api.twelvedata.com/time_series";
  const params = new URLSearchParams({
    symbol: cleanSymbol,
    interval,
    outputsize: String(outputsize),
    apikey: TWELVE_KEY,
    format: "JSON",
  });

  const url = `${base}?${params.toString()}`;
  const res = await fetch(url, { timeout: 10000 });
  const json = await res.json();

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  if (json.status === "error") throw new Error(json.message || "TwelveData API error");

  return json;
}

// ====== FORMAT CANDLES ======
function formatCandlesFromTwelve(resp) {
  if (!resp || !resp.values) return [];
  return resp.values
    .map((v) => ({
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      datetime: v.datetime || v.timestamp,
    }))
    .reverse();
}

// ====== ROUTES ======
app.get("/api/candles", async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol || "EURUSD").toString();
    const interval = (req.query.interval || "1min").toString();
    const limit = parseInt(req.query.limit || "100", 10);

    const cleanSymbol = rawSymbol.replaceAll("/", "").replace(/\s+/g, "").toUpperCase();
    const cacheKey = `${cleanSymbol}|${interval}|${limit}`;

    const cached = getCache(cacheKey);
    if (cached) return res.json({ candles: cached, cached: true });

    const tw = await fetchFromTwelve(cleanSymbol, interval, limit);
    const candles = formatCandlesFromTwelve(tw);

    if (!candles.length)
      return res.status(502).json({ error: "No candles from provider", symbol: cleanSymbol });

    setCache(cacheKey, candles);
    return res.json({ candles });
  } catch (err) {
    console.error("❌ candles error:", err.message);
    return res.status(500).json({
      error: "Failed to fetch candles",
      detail: err.message || String(err),
    });
  }
});

app.get("/api/simulateOutcome", (req, res) => {
  const conf = parseInt(req.query.conf || "70", 10) || 70;
  const seeded = (Date.now() + conf * 13) % 100;
  const result = seeded <= conf ? "WIN" : "LOSS";
  return res.json({ result });
});

app.post("/webhook/signal", (req, res) => {
  console.log("Received webhook:", req.body);
  res.json({ ok: true });
});

// ====== SERVER START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ QS Backend running at http://localhost:${PORT}`);
});