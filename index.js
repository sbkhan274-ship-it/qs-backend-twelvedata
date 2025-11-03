// ====== IMPORTS ======
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

// node-fetch import karo
import fetch from "node-fetch";

dotenv.config();

// ====== APP SETUP ======
const app = express();
app.use(express.json());
app.use(cors());

// Rate limiter
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ====== API KEY ======
const TWELVE_KEY = "f7c98b751b264bf9a8b7d47c57864f18"; // Your key directly

// ====== SIMPLE CACHE ======
const cache = {};
const CACHE_TTL = 60 * 1000; // 1 minute

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
  console.log("🔗 Fetching:", url);
  
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
app.get("/", (req, res) => {
  res.json({ 
    message: "✅ Quantum Scalper Backend Running!",
    endpoints: {
      candles: "/api/candles?symbol=EURUSD&interval=1min&limit=100",
      simulate: "/api/simulateOutcome?conf=70",
      webhook: "POST /webhook/signal",
      health: "/health"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    cacheSize: Object.keys(cache).length
  });
});

app.get("/api/candles", async (req, res) => {
  try {
    const rawSymbol = (req.query.symbol || "EURUSD").toString();
    const interval = (req.query.interval || "1min").toString();
    const limit = parseInt(req.query.limit || "100", 10);

    const cleanSymbol = rawSymbol.replaceAll("/", "").replace(/\s+/g, "").toUpperCase();
    const cacheKey = `${cleanSymbol}|${interval}|${limit}`;

    // Cache check
    const cached = getCache(cacheKey);
    if (cached) {
      console.log("📦 Serving from cache:", cacheKey);
      return res.json({ candles: cached, cached: true });
    }

    console.log("🔄 Fetching fresh data:", cacheKey);
    const tw = await fetchFromTwelve(cleanSymbol, interval, limit);
    const candles = formatCandlesFromTwelve(tw);

    if (!candles.length) {
      return res.status(502).json({ 
        error: "No candles from provider", 
        symbol: cleanSymbol 
      });
    }

    setCache(cacheKey, candles);
    res.json({ 
      candles,
      symbol: cleanSymbol,
      count: candles.length 
    });
    
  } catch (err) {
    console.error("❌ Candles error:", err.message);
    res.status(500).json({
      error: "Failed to fetch candles",
      detail: err.message
    });
  }
});

app.get("/api/simulateOutcome", (req, res) => {
  const conf = parseInt(req.query.conf || "70", 10) || 70;
  const seeded = (Date.now() + conf * 13) % 100;
  const result = seeded <= conf ? "WIN" : "LOSS";
  
  res.json({ 
    result,
    confidence: conf,
    randomValue: seeded 
  });
});

app.post("/webhook/signal", (req, res) => {
  console.log("📡 Received webhook:", req.body);
  res.json({ 
    ok: true,
    message: "Signal received",
    timestamp: new Date().toISOString()
  });
});

// ====== SERVER START ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Quantum Scalper Backend Started!`);
  console.log(`📍 Port: http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${TWELVE_KEY.substring(0, 10)}...`);
  console.log(`📊 Test: http://localhost:${PORT}/api/candles?symbol=EURUSD`);
});