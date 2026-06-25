// ══════════════════════════════════════════════════════════════════
//  GazTracker v4 · Bulut — BITTA SERVIS
//  Node.js + Express + Socket.io + Telegram WEBHOOK
//
//  Imkoniyatlar:
//   • Holatlar: 🟢 Yo'lda · 🟡 Tarqatmoqda · ⚪️ Yakunlangan
//   • Haydovchi yo'lga chiqqanda — /start bosgan mijozlarga avtomatik xabar
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

const DRIVER_IDS = (process.env.DRIVER_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const MOVE_THRESHOLD_M = 25;     // 25 m+ siljisa — Yo'lda
const OFFLINE_MS = 120000;       // 2 daqiqa signal kelmasa — Yakunlangan

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBHOOK_PATH = `/tg/${BOT_TOKEN}`;

app.use(express.json());
app.use(cors());

// ── Holat (serverning xotirasida) ──
let last = null;            // oxirgi {lat,lng,ts}
let online = false;
let moving = false;
const subscribers = new Set(); // /start bosgan mijozlar (xabar yuborish uchun)

function distM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function snapshot(finished = false) {
  return { online, moving, finished, lat: last ? last.lat : null, lng: last ? last.lng : null };
}

app.get("/", (req, res) => res.send("GazTracker v4 (webhook + socket) ishlayapti ✅"));

// ══════════════════════════════════════════════════════════
//  TELEGRAM WEBHOOK
// ══════════════════════════════════════════════════════════
app.post(WEBHOOK_PATH, async (req, res) => {
  res.sendStatus(200);
  const update = req.body || {};
  const msg = update.message || update.edited_message;
  if (!msg) return;

  // ── Joylashuv kelganda ──
  if (msg.location) {
    const chatId = String(msg.chat.id);
    const lat = msg.location.latitude, lng = msg.location.longitude;

    if (DRIVER_IDS.length && !DRIVER_IDS.includes(chatId)) {
      console.log("⛔ Ruxsatsiz joylashuv:", chatId);
      return;
    }

    const wasOnline = online;       // oldingi holatni eslab qolamiz
    if (last) moving = distM(last, { lat, lng }) > MOVE_THRESHOLD_M;
    else moving = true;
    online = true;
    last = { lat, lng, ts: Date.now() };

    io.emit("driverUpdate", snapshot());

    // Offline → Online o'tishi = "haydovchi yo'lga chiqdi" → mijozlarga xabar
    if (!wasOnline) {
      console.log("🚦 Haydovchi yo'lga chiqdi — mijozlarga xabar yuborilmoqda");
      notifyDriverOnline();
    }
    return;
  }

  // ── /start — mijozni ro'yxatga olamiz + xush kelibsiz ──
  if (msg.text === "/start") {
    subscribers.add(String(msg.chat.id));
    await sendStart(msg.chat.id);
  }
});

// ── Signal uzilganini tekshirish (har 20 soniyada) ──
setInterval(() => {
  if (online && last && (Date.now() - last.ts > OFFLINE_MS)) {
    online = false; moving = false;
    io.emit("driverUpdate", snapshot(true));   // Yakunlangan
    console.log("⚪️ Signal uzildi → Yakunlangan");
  }
}, 20000);

// ── Telegram'ga xabar yuborish (umumiy) ──
async function sendMessage(chatId, text, withButton = false) {
  const body = { chat_id: chatId, text };
  if (withButton) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "🗺 Xaritani ochish", web_app: { url: WEBAPP_URL } }]]
    };
  }
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error("sendMessage xatosi:", e.message);
  }
}

// ── /start xabari ──
async function sendStart(chatId) {
  await sendMessage(
    chatId,
    "⛽ GazTracker'ga xush kelibsiz!\n\nQuyidagi tugma orqali gaz mashinasi qayerdaligini jonli kuzating.",
    true
  );
}

// ── Haydovchi yo'lga chiqqanda barcha mijozlarga xabar ──
async function notifyDriverOnline() {
  const text = "🚛 Gaz mashinasi yo'lga chiqdi!\n\nHozir kuzatib borish uchun xaritani oching.";
  for (const chatId of subscribers) {
    if (DRIVER_IDS.includes(chatId)) continue; // haydovchining o'ziga yubormaymiz
    await sendMessage(chatId, text, true);
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

io.on("connection", (socket) => {
  console.log(`🔌 Mijoz ulandi (jami: ${io.engine.clientsCount})`);
  socket.emit("driverUpdate", snapshot(!online && last !== null));
  socket.on("disconnect", () => console.log("❌ Mijoz uzildi"));
});

server.listen(PORT, () => {
  console.log(`🚀 Server ${PORT}-portda ishga tushdi`);
  setWebhook();
});
