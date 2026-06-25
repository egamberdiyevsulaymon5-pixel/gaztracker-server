// ══════════════════════════════════════════════════════════════════
//  GazTracker v4 · Bulut — BITTA SERVIS (yangilangan)
//  Node.js + Express + Socket.io + Telegram WEBHOOK
//
//  Yangiliklar:
//   • /start endi mijozbop: "🗺 Xaritani ochish" tugmasi bilan
//   • (ixtiyoriy) faqat ro'yxatdagi haydovchi mashinani harakatlantiradi
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

// Mini App (xarita) manzili — mijoz tugma bosganda shu ochiladi
const WEBAPP_URL = process.env.WEBAPP_URL ||
  "https://egamberdiyevsulaymon5-pixel.github.io/gaztracker-server/";

// Faqat shu Telegram ID'lari mashinani harakatlantira oladi.
// Bo'sh qoldirsangiz — hamma yubora oladi (sinov uchun).
// To'ldirish: Render'da DRIVER_IDS = "123456789,987654321"
const DRIVER_IDS = (process.env.DRIVER_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBHOOK_PATH = `/tg/${BOT_TOKEN}`;

app.use(express.json());
app.use(cors());

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
    console.log(`📍 Joylashuv (ID: ${chatId}): ${msg.location.latitude}, ${msg.location.longitude}`);

    // Agar haydovchilar ro'yxati to'ldirilgan bo'lsa — faqat ularni qabul qilamiz
    if (DRIVER_IDS.length && !DRIVER_IDS.includes(chatId)) {
      console.log("⛔ Ruxsatsiz joylashuv — e'tiborsiz qoldirildi");
      return;
    }

    io.emit("driverLocation", {
      lat: msg.location.latitude,
      lng: msg.location.longitude,
      ts: Date.now()
    });
    return;
  }

  // ── 2) /start — mijozbop xush kelibsiz + xarita tugmasi ──
  if (msg.text === "/start") {
    await sendStart(msg.chat.id);
  }
});

// ── /start xabari (ichida WebApp tugmasi) ──
async function sendStart(chatId) {
  const text =
    "⛽ GazTracker'ga xush kelibsiz!\n\n" +
    "Quyidagi tugma orqali gaz mashinasi qayerdaligini jonli kuzating.\n\n" +
    "🚛 Haydovchilar uchun: harakatni boshlash uchun 📎 → Location → " +
    "\"Share Live Location\" yuboring.";

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

// ── Server yonganda webhook'ni avtomatik ulash ──
async function setWebhook() {
  if (!PUBLIC_URL) {
    console.warn("⚠️ PUBLIC_URL yo'q — webhook o'rnatilmadi.");
    return;
  }
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
  socket.on("disconnect", () => console.log("❌ Mijoz uzildi"));
});

server.listen(PORT, () => {
  console.log(`🚀 Server ${PORT}-portda ishga tushdi`);
  setWebhook();
});
