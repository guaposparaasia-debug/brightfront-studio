// Brightfront Studio — Stripe webhook (Cloudflare Pages Function)
// ---------------------------------------------------------------------------
// POST /api/stripe-webhook — receives Stripe events for the Checkout Sessions
// created by /api/stripe-checkout, verifies the Stripe-Signature header, and
// handles the same three payments as the PayPal listeners:
//   $250 start (one-time), $250 approval (one-time), $39/month maintenance.
//
// Events handled:
//   checkout.session.completed               — $250 payments (when paid) and new subscriptions
//   checkout.session.async_payment_succeeded — $250 payments that settle later
//   invoice.paid                             — each $39/month maintenance payment
//   customer.subscription.deleted            — maintenance subscription cancelled / ended
//
// Owner gets a Telegram message (Korean) per payment; the customer gets the same
// thank-you email as PayPal on the FIRST $39/month payment only. Dedupe in KV
// ('pay:stripe:<id>') so Stripe retries never double-notify.
// Secrets come only from env: STRIPE_WEBHOOK_SECRET, RESEND_API_KEY,
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. KV binding: LEADS.
// ---------------------------------------------------------------------------
const FROM = "Jackie from Brightfront Studio <info@brightfrontdesign.com>";
const REPLY_TO = "info@brightfrontdesign.com";
const SIG_TOLERANCE_SEC = 300;
const BUILD_AMOUNT = 25000; // $250.00 in cents
const MAINT_AMOUNT = 3900; // $39.00 in cents
const PLAN_KO = { start: "웹사이트 선금 $250", approval: "웹사이트 승인 후 잔금 $250", maintenance: "$39/월 유지보수" };

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
}
function nowIso() { return new Date().toISOString(); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(cents, cur) {
  const n = Number(cents);
  const c = String(cur || "usd").toUpperCase();
  return Number.isFinite(n) ? (c === "USD" ? "$" : "") + (n / 100).toFixed(2) + " " + c : "?";
}

// ---- Stripe signature (Stripe-Signature: t=...,v1=...[,v1=...]) ------------------
function hex(buf) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function verifyStripeSignature(secret, header, raw) {
  if (!secret || !header) return false;
  let t = "";
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > SIG_TOLERANCE_SEC) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + raw)));
  return sigs.some((s) => safeEqual(s, mac));
}

// ---- Thank-you email (Resend) — same wording as the PayPal listeners ----------------
function buildThankYouEmail(p) {
  const first = (p.firstName || "").trim() || "there";
  const subject = "Thank you for your order — let’s build your website!";
  const text = [
    `Hi ${first},`,
    "",
    `Thank you so much for choosing Brightfront Studio! Your payment went through for ${p.emailItemText}.`,
    "",
    "Next step: just reply to this email with:",
    "- Your business name",
    "- Your logo and a few photos",
    "- Your opening hours",
    "- Your menu or list of services",
    "",
    "We start right away and will send you the first version of your website within about 3 business days.",
    "",
    "Any questions at all? Just reply — I read every message.",
    "",
    "Warmly,",
    "Jackie",
    "Brightfront Studio · https://brightfrontdesign.com",
    "",
    `Stripe reference: ${p.refId}`,
  ].join("\n");
  const li = (s) => `<li style="margin:4px 0">${s}</li>`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3eee6">
<div style="max-width:560px;margin:0 auto;padding:28px 18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a1714">
<div style="background:#fffdf8;border:1px solid rgba(26,23,20,.12);border-radius:18px;padding:28px 24px">
<p style="margin:0 0 14px">Hi ${esc(first)},</p>
<p style="margin:0 0 14px">Thank you so much for choosing <strong>Brightfront Studio</strong>! Your payment went through for ${p.emailItemHtml}.</p>
<p style="margin:0 0 6px"><strong>Next step:</strong> just reply to this email with:</p>
<ul style="margin:0 0 14px;padding-left:20px;color:#3f3a34">${li("Your business name")}${li("Your logo and a few photos")}${li("Your opening hours")}${li("Your menu or list of services")}</ul>
<p style="margin:0 0 14px">We start right away and will send you the first version of your website within about <strong>3 business days</strong>.</p>
<p style="margin:0 0 18px">Any questions at all? Just reply — I read every message.</p>
<p style="margin:0">Warmly,<br>Jackie<br><span style="color:#6d665c">Brightfront Studio · <a href="https://brightfrontdesign.com" style="color:#b8431f">brightfrontdesign.com</a></span></p>
</div>
<p style="margin:14px 4px 0;font-size:12px;color:#6d665c">Stripe reference: ${esc(p.refId)}</p>
</div></body></html>`;
  return { subject, text, html };
}
async function sendThankYouEmail(env, p) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  const { subject, text, html } = buildThankYouEmail(p);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "bf-stripe-" + p.id },
    body: JSON.stringify({ from: FROM, to: [p.payerEmail], reply_to: REPLY_TO, subject, html, text }),
  });
  if (!r.ok) throw new Error("resend failed: " + r.status);
}

// ---- Telegram (Korean, plain text) ------------------------------------------
async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("telegram env missing");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error("telegram failed: " + r.status); // never include the URL (contains token)
}
function telegramText(p, emailStatus) {
  const L = [p.titleKo, "금액: " + p.amountKo, "결제자: " + (p.payerName || "-"), "이메일: " + (p.payerEmail || "-"), "상품: " + (p.itemKo || "-"), p.refLabel + ": " + p.refId];
  for (const [k, v] of p.extraKo || []) if (v) L.push(k + ": " + v);
  if (emailStatus) L.push("감사 이메일: " + emailStatus);
  L.push("경로: " + p.source);
  return L.join("\n");
}

// ---- Dedupe in KV + notify -----------------------------------------------------
async function processOnce(env, p) {
  const kv = env.LEADS;
  const key = "pay:stripe:" + p.id;
  let rec = null;
  if (kv) { try { rec = await kv.get(key, "json"); } catch (e) { console.error("kv get failed", e && e.message); } }
  rec = rec || { id: p.id, first_seen: nowIso(), source: p.source };
  const errors = [];
  let emailStatus = null;
  if (p.sendEmail) {
    if (rec.email_sent) emailStatus = "이미 발송됨";
    else if (!p.payerEmail) emailStatus = "결제자 이메일 없음";
    else {
      try {
        await sendThankYouEmail(env, p);
        rec.email_sent = nowIso();
        emailStatus = "발송 완료 → " + p.payerEmail;
      } catch (e) {
        rec.email_error = String(e && e.message || e).slice(0, 200);
        emailStatus = "⚠️ 발송 실패 (자동 재시도 예정)";
        errors.push("email");
      }
    }
  }
  if (!rec.tg_sent) {
    try { await sendTelegram(env, telegramText(p, emailStatus)); rec.tg_sent = nowIso(); } catch (e) { errors.push("telegram"); }
  }
  rec.updated = nowIso();
  if (kv) { try { await kv.put(key, JSON.stringify(rec)); } catch (e) { console.error("kv put failed", e && e.message); } }
  return { id: p.id, errors };
}

// ---- Event handlers --------------------------------------------------------------
function payerOf(obj) {
  const cd = obj.customer_details || {};
  const name = cd.name || obj.customer_name || "";
  return { payerName: name, firstName: name.split(" ")[0] || "", payerEmail: cd.email || obj.customer_email || "" };
}
function idOf(v) { return v && typeof v === "object" ? v.id : v || ""; }

async function onOneTimePaid(env, s, type) {
  const meta = s.metadata || {};
  const plan = meta.brightfront_plan;
  const ok = (plan === "start" || plan === "approval") && s.currency === "usd" && Number(s.amount_total) === BUILD_AMOUNT;
  return processOnce(env, Object.assign({
    id: s.id, sendEmail: false,
    titleKo: ok ? "🎉 새 결제 — " + PLAN_KO[plan] + " (Stripe)" : "💳 Stripe 결제 (금액/상품 확인 필요)",
    amountKo: money(s.amount_total, s.currency), itemKo: ok ? PLAN_KO[plan] : (plan || "-"),
    refLabel: "Stripe Checkout ID", refId: s.id,
    extraKo: [["결제 ID", idOf(s.payment_intent)], ["상호", meta.business], ["요청 이메일", meta.request_email], ["ref", meta.ref]],
    source: "Stripe " + type,
  }, payerOf(s)));
}

async function onSubscriptionCheckout(env, s, type) {
  const meta = s.metadata || {};
  const ok = meta.brightfront_plan === "maintenance" && s.currency === "usd" && Number(s.amount_total) === MAINT_AMOUNT;
  return processOnce(env, Object.assign({
    id: s.id, sendEmail: false,
    titleKo: ok ? "🎉 새 구독 신청 — $39/월 유지보수 (Stripe)" : "💳 Stripe 구독 신청 (조건 다름 — 확인 필요)",
    amountKo: money(s.amount_total, s.currency) + "/월 유지보수", itemKo: PLAN_KO.maintenance,
    refLabel: "Stripe 구독 ID", refId: idOf(s.subscription) || s.id,
    extraKo: [["상호", meta.business], ["ref", meta.ref]],
    source: "Stripe " + type,
  }, payerOf(s)));
}

async function onInvoicePaid(env, inv, type) {
  const subId = idOf(inv.subscription) || idOf(inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription);
  if (!subId) return { ignored: "invoice without subscription" };
  const subMeta = (inv.subscription_details && inv.subscription_details.metadata)
    || (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.metadata) || {};
  const ok = inv.currency === "usd" && Number(inv.amount_paid) === MAINT_AMOUNT;
  const isFirst = inv.billing_reason === "subscription_create";
  const planText = "$39/month maintenance for your website, after the $250 + $250 build payments";
  return processOnce(env, Object.assign({
    id: inv.id, sendEmail: ok && isFirst,
    emailItemHtml: "the <strong>Brightfront Studio website maintenance</strong> plan (" + planText + ")",
    emailItemText: "the Brightfront Studio website maintenance plan (" + planText + ")",
    titleKo: ok ? (isFirst ? "🎉 새 결제 — 구독 첫 결제 $39/월 유지보수 (Stripe)" : "💳 구독 결제 $39/월 유지보수 (Stripe)") : "💳 Stripe 구독 결제 (금액 확인 필요)",
    amountKo: money(inv.amount_paid, inv.currency), itemKo: PLAN_KO.maintenance,
    refLabel: "Stripe 인보이스 ID", refId: inv.id,
    extraKo: [["구독 ID", subId], ["상호", subMeta.business]],
    source: "Stripe " + type,
  }, payerOf(inv)));
}

async function onSubscriptionDeleted(env, sub) {
  const key = "pay:stripe:subend:" + sub.id;
  if (env.LEADS) { try { if (await env.LEADS.get(key)) return { duplicate: true }; } catch (_) {} }
  try {
    await sendTelegram(env, "Stripe 구독 해지/종료: " + sub.id + " / " + ((sub.metadata && sub.metadata.business) || "-"));
  } catch (e) { return { errors: ["telegram"] }; }
  if (env.LEADS) { try { await env.LEADS.put(key, nowIso()); } catch (_) {} }
  return { ok: true };
}

async function handleEvent(env, event) {
  const type = event.type;
  const obj = (event.data && event.data.object) || {};
  switch (type) {
    case "checkout.session.completed":
      if (obj.mode === "subscription") return onSubscriptionCheckout(env, obj, type);
      if (obj.mode === "payment") {
        if (obj.payment_status !== "paid") return { ignored: "payment_status " + obj.payment_status };
        return onOneTimePaid(env, obj, type);
      }
      return { ignored: "mode " + obj.mode };
    case "checkout.session.async_payment_succeeded":
      if (obj.mode === "payment") return onOneTimePaid(env, obj, type);
      return { ignored: "mode " + obj.mode };
    case "invoice.paid":
      return onInvoicePaid(env, obj, type);
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(env, obj);
    default:
      return { ignored: type || "unknown" };
  }
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  if (!env.STRIPE_WEBHOOK_SECRET) { console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET missing"); return json({ ok: false, error: "not configured" }, 503); }
  let verified = false;
  try { verified = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get("Stripe-Signature"), raw); } catch (e) { console.error("stripe verify error", e && e.message); }
  if (!verified) { console.warn("stripe-webhook: signature verification FAILED"); return json({ ok: false, error: "signature verification failed" }, 400); }
  let event;
  try { event = JSON.parse(raw); } catch (_) { return json({ ok: false, error: "bad json" }, 400); }
  try {
    const result = await handleEvent(env, event);
    console.log("stripe-webhook", event.type, event.id, JSON.stringify(result));
    if (result && result.errors && result.errors.length) return json({ ok: false, result }, 500); // Stripe will retry
    return json({ ok: true, result });
  } catch (e) {
    console.error("stripe-webhook handler error", e && e.message);
    return json({ ok: false, error: "handler error" }, 500);
  }
}
