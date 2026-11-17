// Brightfront Studio — website lead capture (Cloudflare Pages Function)
// POST /api/builder-lead
//   { event: "started" | "preview" }                      -> bumps stat:builder:<YYYY-MM-DD> counters
//   { event: "submit", email, message?, name?, page, hp } -> saves lead:builder:<ISO>-<rand>, Telegram alert, Resend email
// Env (secrets only from env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESEND_API_KEY, LEAD_NOTIFY_EMAIL (optional). KV binding: LEADS.

const MAX_BODY = 16 * 1024;
const RATE_LIMIT = 5;            // submits per IP per window
const RATE_WINDOW_S = 3600;
const LEAD_TTL_S = 365 * 24 * 3600;
const DEFAULT_NOTIFY = "guaposparaasia@gmail.com";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function str(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max); }
// Multi-line variant for the free-text message: keeps newlines/tabs, strips other control chars.
function text(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sendTelegram(env, msg) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("telegram env missing");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg.slice(0, 4000), disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("telegram failed: " + r.status); // never include the URL (contains token)
}

async function sendResend(env, rec) {
  if (!env.RESEND_API_KEY) throw new Error("resend env missing");
  const to = str(env.LEAD_NOTIFY_EMAIL, 200) || DEFAULT_NOTIFY;
  const body = [
    "New website request",
    "",
    "Email: " + rec.email,
    rec.name ? "Name: " + rec.name : "",
    "Message: " + (rec.message || "-"),
    "Page: " + (rec.page || "-"),
    "Time: " + rec.createdAt + " (UTC)",
  ].filter((l, i) => l !== "" || i === 1).join("\n");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Brightfront Studio <info@brightfrontdesign.com>",
      to: [to],
      reply_to: rec.email,
      subject: "New website request: " + rec.email,
      text: body,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("resend failed: " + r.status); // status only, never the key or response body
}

async function bumpStat(kv, field) {
  const day = new Date().toISOString().slice(0, 10);
  const key = "stat:builder:" + day;
  let rec = {};
  try { rec = (await kv.get(key, "json")) || {}; } catch (e) {}
  rec[field] = (rec[field] || 0) + 1;
  rec.updatedAt = new Date().toISOString();
  await kv.put(key, JSON.stringify(rec), { expirationTtl: 400 * 24 * 3600 });
  return rec;
}

export async function onRequestPost({ request, env }) {
  const kv = env.LEADS;
  if (!kv) return json({ ok: false, error: "not configured" }, 503);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY) return json({ ok: false, error: "too large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "too large" }, 413);
  let b;
  try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
  if (!b || typeof b !== "object") return json({ ok: false, error: "bad body" }, 400);

  const event = str(b.event, 20) || "submit";
  if (event === "started" || event === "preview") {
    try { await bumpStat(kv, event); } catch (e) { console.error("stat failed", e && e.message); }
    return json({ ok: true });
  }
  if (event !== "submit") return json({ ok: false, error: "bad event" }, 400);

  // Honeypot: bots fill hidden fields. Pretend success, store nothing.
  if (str(b.hp, 200)) return json({ ok: true });

  const name = str(b.name, 80);                 // optional
  const email = str(b.email, 120);
  const message = text(b.message, 2000);        // optional, max 2000 chars
  const storeName = str(b.storeName, 120);      // optional (legacy)
  const category = str(b.category, 40);         // optional (legacy)
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "email" }, 400);
  const products = (Array.isArray(b.products) ? b.products : []).slice(0, 30).map((p) => ({ name: str(p && p.name, 100), price: str(p && p.price, 20) }));
  const photoCount = Math.max(0, Math.min(100, parseInt(b.photoCount, 10) || 0));

  // Per-IP rate limit (KV counter with TTL).
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rlKey = "rl:builder:" + ip;
  let count = 0;
  try { count = parseInt((await kv.get(rlKey)) || "0", 10) || 0; } catch (e) {}
  if (count >= RATE_LIMIT) return json({ ok: false, error: "rate limited" }, 429);
  try { await kv.put(rlKey, String(count + 1), { expirationTtl: RATE_WINDOW_S }); } catch (e) {}

  const createdAt = new Date().toISOString();
  const key = "lead:builder:" + createdAt + "-" + crypto.randomUUID().slice(0, 8);
  const rec = {
    source: str(b.source, 40) || "website", message, createdAt, name, email, storeName, category, products, photoCount,
    page: str(b.page, 200), ua: str(request.headers.get("user-agent"), 200),
    country: (request.cf && request.cf.country) || "",
  };
  try { await kv.put(key, JSON.stringify(rec), { expirationTtl: LEAD_TTL_S }); }
  catch (e) { console.error("kv put failed", e && e.message); return json({ ok: false, error: "store" }, 500); }
  try { await bumpStat(kv, "submit"); } catch (e) {}

  // Notifications run in parallel; neither can break the response.
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const tgText = [
    "🌐 새 웹사이트 요청 (Brightfront)",
    "이메일: " + email,
    name ? "이름: " + name : "",
    "메시지: " + (message || "-"),
    storeName ? "스토어: " + storeName + " / " + (category || "-") : "",
    products.length || photoCount ? "상품 " + products.length + "개 · 사진 " + photoCount + "장" : "",
    products.slice(0, 8).map((p) => "• " + p.name + (p.price ? " — " + p.price : "")).join("\n"),
    "페이지: " + (rec.page || "-"),
    "시간: " + kst + " (UTC+9)",
    "KV: " + key,
  ].filter(Boolean).join("\n");

  const [tg, mail] = await Promise.all([
    sendTelegram(env, tgText).then(() => "ok", (e) => { console.error("builder telegram", e && e.message); return "failed"; }),
    sendResend(env, rec).then(() => "ok", (e) => { console.error("builder resend", e && e.message); return "failed"; }),
  ]);
  return json({ ok: true, key, telegram: tg, email: mail });
}

export function onRequest() { return json({ ok: false, error: "method" }, 405); }