// Brightfront Studio — Lemon Squeezy webhook (Cloudflare Pages Function)
// POST /api/lemon-webhook  -> verifies X-Signature (HMAC-SHA256 of raw body, hex)
//   -> KV (LEADS) key pay:lemon:<event>:<id> (includes checkout custom data) + Telegram alert
// Checkout fields set by index.html: checkout[custom][business_name|preview_ref|source], checkout[name]
// Env (secrets only from env): LEMON_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. KV binding: LEADS.
const enc = new TextEncoder();
const MAX_BODY = 256 * 1024;

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("telegram env missing");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error("telegram failed: " + r.status); // never include the URL (contains token)
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
const s = (v, n = 300) => (v == null ? "" : String(v)).slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!env.LEMON_WEBHOOK_SECRET) return json({ ok: false, error: "not configured" }, 500);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "too large" }, 413);
  const sig = (request.headers.get("X-Signature") || "").trim().toLowerCase();
  if (!sig || !safeEqual(await hmacHex(env.LEMON_WEBHOOK_SECRET, raw), sig)) return json({ ok: false, error: "bad signature" }, 401);

  let p;
  try { p = JSON.parse(raw); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const meta = p.meta || {};
  const event = s(meta.event_name || request.headers.get("X-Event-Name") || "unknown", 60);
  const custom = meta.custom_data && typeof meta.custom_data === "object" ? meta.custom_data : {};
  const d = p.data || {};
  const a = d.attributes || {};
  const id = s(d.id, 60);
  if (!id) return json({ ok: true, ignored: true });

  const key = "pay:lemon:" + event + ":" + id;
  const kv = env.LEADS;
  if (kv) { try { if (await kv.get(key)) return json({ ok: true, dup: true, key }); } catch (e) {} }

  const rec = {
    provider: "lemonsqueezy", event, id, type: s(d.type, 40), status: s(a.status, 40),
    test: !!(meta.test_mode || a.test_mode),
    email: s(a.user_email || a.customer_email), name: s(a.user_name || a.customer_name),
    total: s(a.total_formatted || a.subtotal_formatted || a.total), currency: s(a.currency, 10),
    product: s(a.product_name || (a.first_order_item && a.first_order_item.product_name)),
    variant: s(a.variant_name || (a.first_order_item && a.first_order_item.variant_name)),
    orderId: s(a.order_id || (d.type === "orders" ? id : ""), 60),
    subscriptionId: s(d.type === "subscriptions" ? id : a.subscription_id, 60),
    businessName: s(custom.business_name, 200), previewRef: s(custom.preview_ref, 500), source: s(custom.source, 100),
    custom, receivedAt: new Date().toISOString(),
  };
  let stored = false;
  if (kv) { try { await kv.put(key, JSON.stringify(rec)); stored = true; } catch (e) { console.error("kv put failed", e && e.message); } }

  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  const lines = [
    (rec.test ? "🧪 TEST " : "") + "💳 Lemon Squeezy 결제 이벤트: " + event + " (Brightfront)",
    "비즈니스: " + (rec.businessName || "(미입력)"),
    "프리뷰/사이트: " + (rec.previewRef || "-"),
    "고객: " + ([rec.name, rec.email].filter(Boolean).join(" / ") || "-"),
    "금액: " + (rec.total || "-") + " · 상태: " + (rec.status || "-"),
    "상품: " + ([rec.product, rec.variant].filter(Boolean).join(" / ") || "-"),
    "LS " + (rec.type || "id") + ": " + id + (rec.source ? " · 출처: " + rec.source : ""),
    "시간: " + kst + " (UTC+9)",
    "KV: " + (stored ? key : "저장 실패"),
  ];
  let telegram = "ok";
  try { await sendTelegram(env, lines.join("\n")); }
  catch (e) { console.error("telegram", e && e.message); telegram = "failed"; }
  if (!stored && telegram !== "ok") return json({ ok: false, error: "retry" }, 500); // let Lemon retry
  return json({ ok: true, key, stored, telegram });
}
export function onRequest() { return json({ ok: false, error: "method" }, 405); }
