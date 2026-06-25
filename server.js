// ══════════════════════════════════════════════════════════════════
//  GazTracker v4 · Bulut — BITTA SERVIS
//  Node.js + Express + Socket.io + Telegram WEBHOOK
//
//  Holatlar (mijozga ko'rinadi):
//   🟢 Yo'lda       — mashina harakatlanyapti
//   🟡 Tarqatmoqda  — to'xtagan, lekin joylashuv yoqiq (balon beryapti)
//   ⚪️ Yakunlangan  — joylashuv uzildi (tarqatish tugadi)
// ══════════════════════════════════════════════════════════════════

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ── Sozlamalar (Render → Environment Variables) ──
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN_BERILMAGAN";
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";
const WEBAPP_URL = process.env.WEBAPP_URL ||
  "https://egamberdiyevsulaymon5-pixel.github.io/gaztracker-server/";

// Faqat shu Telegram ID'lari mashinani harakatlantira oladi.
// Bo'sh qoldirsangiz — hamma yubora oladi (sinov uchun).
const DRIVER_IDS = (process.env.DRIVER_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// Holatni aniqlash uchun chegaralar
const MOVE_THRESHOLD_M = 25;     // 25 metrdan ko'p siljisa — "Yo'lda"
const OFFLINE_MS = 120000;       // 2 daqiqa signal kelmasa — "Yakunlangan"

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBHOOK_PATH = `/tg/${BOT_TOKEN}`;

app.use(express.json());
app.use(cors());

// ── Haydovchi holati (serverning xotirasida) ──
let last = null;          // oxirgi {lat, lng, ts}
let online = false;       // joylashuv yoqiqmi?
let moving = false;       // harakatlanyaptimi?

// Ikki nuqta orasidagi masofa (metr) — haversine
function distM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Joriy holatni tuzib beradi
function snapshot(finished = false) {
  return {
    online, moving, finished,
    lat: last ? last.lat : null,
    lng: last ? last.lng : null
  };
}

app.get("/", (req, res) => {
  res.send("GazTracker v4 (webhook + socket) ishlayapti ✅");
});

// ══════════════════════════════════════════════════════════
//  TELEGRAM WEBHOOK
// ══════════════════════════════════════════════════════════
app.post(WEBHOOK_PATH, async (req, res) => {
  res.sendStatus(200);
  const update = req.body || {};
  const msg = update.message || update.edited_message;
  if (!msg) return;

  // ── 1) Joylashuv kelganda ──
  if (msg.location) {
    const chatId = String(msg.chat.id);
    const lat = msg.location.latitude, lng = msg.location.longitude;
    console.log(`📍 Joylashuv (ID: ${chatId}): ${lat}, ${lng}`);

    // Faqat ro'yxatdagi haydovchi (agar ro'yxat to'ldirilgan bo'lsa)
    if (DRIVER_IDS.length && !DRIVER_IDS.includes(chatId)) {
      console.log("⛔ Ruxsatsiz joylashuv — e'tiborsiz qoldirildi");
      return;
    }

    // Harakatlanyaptimi yoki to'xtaganmi?
    if (last) {
      const d = distM(last, { lat, lng });
      moving = d > MOVE_THRESHOLD_M;   // 25m+ siljisa — Yo'lda
    } else {
      moving = true;                   // yangi boshlandi — Yo'lda deb hisoblaymiz
    }
    online = true;
    last = { lat, lng, ts: Date.now() };

    io.emit("driverUpdate", snapshot());
    console.log(`   → holat: ${moving ? "Yo'lda 🟢" : "Tarqatmoqda 🟡"}`);
    return;
  }

  // ── 2) /start — mijozbop xush kelibsiz + xarita tugmasi ──
  if (msg.text === "/start") {
    await sendStart(msg.chat.id);
  }
});

// ── Signal uzilganini tekshirish (har 20 soniyada) ──
setInterval(() => {
  if (online && last && (Date.now() - last.ts > OFFLINE_MS)) {
    online = false;
    moving = false;
    io.emit("driverUpdate", snapshot(true));   // Yakunlangan
    console.log("⚪️ Signal uzildi → Yakunlangan");
  }
}, 20000);

// ── /start xabari (ichida WebApp tugmasi) ──
async function sendStart(chatId) {
  const text =
    "⛽ GazTracker'ga xush kelibsiz!\n\n" +
    "Quyidagi tugma orqali gaz mashinasi qayerdaligini jonli kuzating.";

  const reply_markup = {
    inline_keyboard: [[
      { text: "🗺 Xaritani ochish", web_app: { url: WEBAPP_URL } }
    ]]
  };

  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup })
    });
  } catch (e) {
    console.error("sendStart xatosi:", e.message);
  }
}

// ── Webhook'ni avtomatik ulash ──
async function setWebhook() {
  if (!PUBLIC_URL) { console.warn("⚠️ PUBLIC_URL yo'q."); return; }
  const url = `${PUBLIC_URL}${WEBHOOK_PATH}`;
  try {
    const r = await fetch(`${TG_API}/setWebhook?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    console.log("🔗 Webhook:", j.ok ? "ulandi ✅" : JSON.stringify(j));
  } catch (e) {
    console.error("setWebhook xatosi:", e.message);
  }
}

// ── Yangi mijoz ulanganda — joriy holatni darhol yuboramiz ──
io.on("connection", (socket) => {
  console.log(`🔌 Mijoz ulandi (jami: ${io.engine.clientsCount})`);
  socket.emit("driverUpdate", snapshot(!online && last !== null));
  socket.on("disconnect", () => console.log("❌ Mijoz uzildi"));
});

server.listen(PORT, () => {
  console.log(`🚀 Server ${PORT}-portda ishga tushdi`);
  setWebhook();
});
