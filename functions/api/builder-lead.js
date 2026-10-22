// Brightfront Studio — store-builder lead capture (Cloudflare Pages Function)
// POST /api/builder-lead
//   { event: "started" | "preview" }                      -> bumps stat:builder:<YYYY-MM-DD> counters
//   { event: "submit", name, email, storeName, category, products:[{name,price}], photoCount, page, hp }
//                                                           -> saves lead:builder:<ISO>-<rand> + Telegram alert
// Env (secrets only from env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. KV binding: LEADS.

const MAX_BODY = 16 * 1024;
const RATE_LIMIT = 5;            // submits per IP per window
const RATE_WINDOW_S = 3600;
const LEAD_TTL_S = 365 * 24 * 3600;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function str(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("telegram env missing");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error("telegram failed: " + r.status); // never include the URL (contains token)
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

  const name = str(b.name, 80);
  const email = str(b.email, 120);
  const storeName = str(b.storeName, 120);
  const category = str(b.category, 40);
  if (name.length < 2) return json({ ok: false, error: "name" }, 400);
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
    source: str(b.source, 40) || "builder", message: str(b.message, 2000), createdAt, name, email, storeName, category, products, photoCount,
    page: str(b.page, 200), ua: str(request.headers.get("user-agent"), 200),
    country: (request.cf && request.cf.country) || "",
  };
  try { await kv.put(key, JSON.stringify(rec), { expirationTtl: LEAD_TTL_S }); }
  catch (e) { console.error("kv put failed", e && e.message); return json({ ok: false, error: "store" }, 500); }
  try { await bumpStat(kv, "submit"); } catch (e) {}

  let telegram = "skipped";
  try {
    const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
    await sendTelegram(env, [
      "🛒 새 스토어 빌더 리드 (Brightfront)",
      "이름: " + name,
      "이메일: " + email,
      "스토어: " + (storeName || "-") + " / " + (category || "-"),
      ...(rec.message ? ["메시지: " + rec.message, "출처: " + rec.source] : []),
      "상품 " + products.length + "개 · 사진 " + photoCount + "장",
      products.slice(0, 8).map((p) => "• " + p.name + (p.price ? " — " + p.price : "")).join("\n"),
      "시간: " + kst + " (UTC+9)",
      "KV: " + key,
    ].filter(Boolean).join("\n"));
    telegram = "ok";
  } catch (e) { telegram = "failed"; console.error("builder telegram", e && e.message); }
  return json({ ok: true, key, telegram });
}

export function onRequest() { return json({ ok: false, error: "method" }, 405); }
