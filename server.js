// ══════════════════════════════════════════════════════════════════
//  GazTracker v4 · Bulut versiyasi — BITTA SERVIS
//  Node.js + Express + Socket.io + Telegram WEBHOOK
//
//  Bu fayl ikki vazifani BIRGA bajaradi (alohida Python bot kerak emas):
//   1) Telegram'dan webhook orqali jonli joylashuvni qabul qiladi
//   2) Koordinatani Socket.io orqali WebApp xaritasiga real vaqtda uzatadi
//
//  Nega webhook? Render bepul tarifda doimiy "polling" jarayonini
//  bepul ushlab turolmaydi. Webhook'da esa Telegram'ning o'zi serverga
//  so'rov yuboradi — bu bepul web service bilan mukammal ishlaydi.
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

// ── Sozlamalar (Render'da Environment Variables sifatida beriladi) ──
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "BOT_TOKEN_BERILMAGAN";
// Render har bir servisga ommaviy URL beradi (RENDER_EXTERNAL_URL).
// Lokal sinovda esa qo'lda PUBLIC_URL berishingiz mumkin.
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || "";

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const WEBHOOK_PATH = `/tg/${BOT_TOKEN}`; // token yo'lda — oddiy himoya vazifasi

app.use(express.json());
app.use(cors());

// ── Sog'liq tekshiruvi ──
app.get("/", (req, res) => {
  res.send("GazTracker v4 (webhook + socket) ishlayapti ✅");
});

// ══════════════════════════════════════════════════════════
//  TELEGRAM WEBHOOK — barcha update'lar shu yerga keladi
// ══════════════════════════════════════════════════════════
app.post(WEBHOOK_PATH, async (req, res) => {
  res.sendStatus(200); // Telegram'ga darhol "qabul qildim" deymiz

  const update = req.body || {};
  // Jonli joylashuv ham yangi xabarda, ham tahrirlangan xabarda keladi
  const msg = update.message || update.edited_message;
  if (!msg) return;

  // 1) Joylashuv kelgan bo'lsa — xaritaga uzatamiz
  if (msg.location) {
    const { latitude, longitude } = msg.location;
    io.emit("driverLocation", { lat: latitude, lng: longitude, ts: Date.now() });
    console.log(`📍 ${latitude}, ${longitude} -> ${io.engine.clientsCount} ta mijozga`);
  }

  // 2) /start bo'lsa — haydovchiga yo'riqnoma yuboramiz
  if (msg.text === "/start") {
    await sendMessage(
      msg.chat.id,
      "🚛 GazTracker haydovchi paneli\n\n" +
      "Harakatni boshlash uchun:\n" +
      "📎 -> Location -> \"Share Live Location\" -> vaqtni tanlang.\n\n" +
      "Joylashuvingiz avtomatik kuzatib boriladi."
    );
  }
});

// ── Telegram'ga xabar yuborish (built-in fetch, Node 18+) ──
async function sendMessage(chatId, text) {
  try {
    await fetch(`${TG_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) {
    console.error("sendMessage xatosi:", e.message);
  }
}

// ── Server yonganda webhook'ni avtomatik ulaymiz ──
async function setWebhook() {
  if (!PUBLIC_URL) {
    console.warn("⚠️ PUBLIC_URL yo'q — webhook o'rnatilmadi (lokal rejim).");
    return;
  }
  const url = `${PUBLIC_URL}${WEBHOOK_PATH}`;
  try {
    const r = await fetch(`${TG_API}/setWebhook?url=${encodeURIComponent(url)}`);
    const j = await r.json();
    console.log("🔗 Webhook:", j.ok ? "ulandi ✅ " + url : JSON.stringify(j));
  } catch (e) {
    console.error("setWebhook xatosi:", e.message);
  }
}

// ── Socket.io ulanishlari ──
io.on("connection", (socket) => {
  console.log(`🔌 Mijoz ulandi (jami: ${io.engine.clientsCount})`);
  socket.on("disconnect", () => console.log("❌ Mijoz uzildi"));
});

server.listen(PORT, () => {
  console.log(`🚀 Server ${PORT}-portda ishga tushdi`);
  setWebhook();
});
