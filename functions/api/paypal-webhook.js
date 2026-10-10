// Brightfront Studio — PayPal REST webhook listener (Cloudflare Pages Function)
// ---------------------------------------------------------------------------
// Shared payment-notification core (kept inline in both paypal-webhook.js and
// paypal-ipn.js so each Pages Function is self-contained).
// Secrets come only from env: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID,
// RESEND_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. KV binding: LEADS.
// ---------------------------------------------------------------------------
const FROM = "Jackie from Brightfront Studio <info@brightfrontdesign.com>";
const REPLY_TO = "info@brightfrontdesign.com";
const RECEIVER_EMAIL = "chedamso@naver.com";
const PAYPAL_API = "https://api-m.paypal.com";

const PACKAGES = {
  starter: { name: "Starter website", price: 299, salePrice: 149.5 },
  business: { name: "Business website", price: 699, salePrice: 349.5 },
  premium: { name: "Premium website", price: 1299, salePrice: 649.5 },
};
// 50% launch sale: ends 2026-10-31 23:59 US Eastern. Sale amounts are accepted until
// SALE_END + SALE_GRACE_MS (covers late IPN/webhook delivery and retries).
const SALE_END = Date.parse("2026-11-01T03:59:00Z");
const SALE_GRACE_MS = 3 * 24 * 3600 * 1000;
function saleAccepted() { return Date.now() < SALE_END + SALE_GRACE_MS; }
function minPrice(pack) { const p = PACKAGES[pack]; return p ? (saleAccepted() && p.salePrice ? p.salePrice : p.price) : NaN; }
const TIERS = {
  basic: { name: "Basic", monthly: 19 },
  standard: { name: "Standard", monthly: 39 },
  pro: { name: "Pro", monthly: 69 },
};
const TRIAL_MONTHS = { starter: 1, business: 1, premium: 3 };
const PLAN_MAP = {
  "P-37C72428AU1150909NLEHO6Y": ["starter", "basic"],
  "P-4PJ33085CC684101TNLEHO7A": ["starter", "standard"],
  "P-6YX189848F5148447NLEHO7A": ["starter", "pro"],
  "P-2JH365063T5835500NLEHO7I": ["business", "basic"],
  "P-41B15152K0381711XNLEHO7I": ["business", "standard"],
  "P-3WP32352G4740301WNLEHO7Q": ["business", "pro"],
  "P-83H864985W745880BNLEHO7Q": ["premium", "basic"],
  "P-6K19213792447484YNLEHO7Y": ["premium", "standard"],
  "P-2G234491388005507NLEHO7Y": ["premium", "pro"],
  "P-4RS85756FB082311UNLE4B5Y": ["starter", "basic"], // sale50
  "P-1CF2133630833574BNLE4B5Y": ["starter", "standard"], // sale50
  "P-43K10290WU734083JNLE4B6A": ["starter", "pro"], // sale50
  "P-6LE0506546269533FNLE4B6A": ["business", "basic"], // sale50
  "P-6MR23270EM335745GNLE4B6I": ["business", "standard"], // sale50
  "P-0CR88982JB235362BNLE4B6I": ["business", "pro"], // sale50
  "P-91F51348VA604234KNLE4B6Q": ["premium", "basic"], // sale50
  "P-87N37805SR510571XNLE4B6Q": ["premium", "standard"], // sale50
  "P-1XV43892V2389972YNLE4B6Y": ["premium", "pro"], // sale50
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function usd(v) { const n = num(v); return Number.isFinite(n) ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : String(v || ""); }
function amountText(v, cur) { const n = num(v); const s = Number.isFinite(n) ? n.toFixed(2) : String(v || "?"); return (cur === "USD" || !cur ? "$" : "") + s + " " + (cur || "USD"); }
function sameAmount(a, b) { return Number.isFinite(num(a)) && Number.isFinite(num(b)) && Math.abs(num(a) - num(b)) < 0.005; }
function packFromText(s) { s = String(s || "").toLowerCase(); return Object.keys(PACKAGES).find((k) => s.includes(k)) || null; }
function packFromAmount(v) { return Object.keys(PACKAGES).find((k) => sameAmount(v, PACKAGES[k].price) || (saleAccepted() && sameAmount(v, PACKAGES[k].salePrice))) || null; }
function parseCustomId(cid) {
  const m = /^brightfront-(starter|business|premium)-(basic|standard|pro)$/i.exec(String(cid || "").trim());
  return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nowIso() { return new Date().toISOString(); }

// ---- PayPal REST --------------------------------------------------------
async function paypalToken(env) {
  const r = await fetch(PAYPAL_API + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_SECRET),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("paypal oauth failed: " + r.status);
  const j = await r.json();
  if (!j.access_token) throw new Error("paypal oauth: no token");
  return j.access_token;
}
async function paypalGet(token, path) {
  const r = await fetch(PAYPAL_API + path, { headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error("paypal GET " + path + " -> " + r.status);
  return r.json();
}

// ---- Thank-you email (Resend) ----------------------------------------------
// p.emailItemHtml / p.emailItemText describe what was bought.
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
    `PayPal reference: ${p.refId}`,
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
<p style="margin:14px 4px 0;font-size:12px;color:#6d665c">PayPal reference: ${esc(p.refId)}</p>
</div></body></html>`;
  return { subject, text, html };
}
async function sendThankYouEmail(env, p) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");
  const { subject, text, html } = buildThankYouEmail(p);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "bf-pay-" + p.id,
    },
    body: JSON.stringify({ from: FROM, to: [p.payerEmail], reply_to: REPLY_TO, subject, html, text }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.text()).slice(0, 200); } catch (_) {}
    throw new Error("resend failed: " + r.status + " " + detail);
  }
}

// ---- Telegram (Korean, plain text) ------------------------------------------
function buildTelegram(p, mode, emailStatus) {
  const L = [];
  L.push(p.titleKo || "💳 새 결제");
  if (mode === "supplement") L.push("ℹ️ 결제자 정보 보완 (같은 결제)");
  L.push("금액: " + (p.amountKo || "-"));
  L.push("결제자: " + (p.payerName || "-"));
  L.push("이메일: " + (p.payerEmail || "-"));
  L.push("상품: " + (p.itemKo || "-"));
  L.push((p.refLabel || "PayPal ID") + ": " + (p.refId || p.id));
  for (const [k, v] of p.extraKo || []) if (v) L.push(k + ": " + v);
  L.push("메모: " + (p.memo ? String(p.memo) : "없음"));
  if (emailStatus) L.push("감사 이메일: " + emailStatus);
  L.push("경로: " + (p.source || "-"));
  return L.join("\n");
}
async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error("telegram env missing");
  const r = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error("telegram failed: " + r.status); // never include the URL (contains token)
}

// ---- Dedupe + record in KV ('pay:<id>') + notify ------------------------------
// p: { id, kind, sendEmail, notify, payerName, payerEmail, firstName, emailItemHtml,
//      emailItemText, titleKo, amountKo, itemKo, refLabel, refId, extraKo, memo, source }
const REC_FIELDS = ["kind", "payerName", "payerEmail", "firstName", "itemKo", "amountKo", "refLabel", "refId", "memo", "amount", "currency"];
async function processPayment(env, p) {
  const kv = env.LEADS;
  const key = "pay:" + p.id;
  let rec = null;
  if (kv) { try { rec = await kv.get(key, "json"); } catch (e) { console.error("kv get failed", e && e.message); } }
  const isNew = !rec;
  rec = rec || { id: p.id, first_seen: nowIso() };
  const v = Object.assign({}, p);
  for (const f of REC_FIELDS) {
    if (!v[f] && rec[f]) v[f] = rec[f];
    if (v[f] && !rec[f]) rec[f] = v[f];
  }
  rec.sources = Array.from(new Set([...(rec.sources || []), p.source].filter(Boolean)));
  rec.updated = nowIso();
  const save = async () => { if (kv) { try { await kv.put(key, JSON.stringify(rec)); } catch (e) { console.error("kv put failed", e && e.message); } } };
  const errors = [];
  const actions = [];

  // 1) thank-you email (once per payment id)
  let emailStatus = null;
  let emailJustSent = false;
  if (p.sendEmail) {
    if (rec.email_sent) emailStatus = "이미 발송됨 (" + (rec.email_to || "") + ")";
    else if (!v.payerEmail) emailStatus = "결제자 이메일 없음 — 상세 정보 수신 대기";
    else {
      try {
        await sendThankYouEmail(env, v);
        rec.email_sent = nowIso();
        rec.email_to = v.payerEmail;
        delete rec.email_error;
        emailJustSent = true;
        emailStatus = "발송 완료 → " + v.payerEmail;
        actions.push("email");
        await save();
      } catch (e) {
        rec.email_error = String(e && e.message || e).slice(0, 200);
        emailStatus = "⚠️ 발송 실패 (자동 재시도 예정)";
        errors.push("email");
      }
    }
  } else if (p.kind === "onetime" || p.kind === "subscription") {
    emailStatus = "자동 발송 안 함 (확인 필요)";
  }

  // 2) Telegram to owner (once; plus one supplement if payer details arrive later)
  if (p.notify !== false) {
    let mode = null;
    if (!rec.tg_sent) mode = "first";
    else if (!rec.tg_has_payer && v.payerEmail) mode = "supplement";
    else if (emailJustSent && rec.tg_email_failed) mode = "email-retry";
    if (mode) {
      const text = mode === "email-retry"
        ? "✅ 감사 이메일 재시도 발송 완료 → " + v.payerEmail + "\n" + (v.refLabel || "PayPal ID") + ": " + (v.refId || v.id)
        : buildTelegram(v, mode, emailStatus);
      try {
        await sendTelegram(env, text);
        rec.tg_sent = rec.tg_sent || nowIso();
        if (v.payerEmail) rec.tg_has_payer = true;
        rec.tg_email_failed = errors.includes("email");
        actions.push("telegram:" + mode);
      } catch (e) {
        errors.push("telegram");
      }
    }
  }
  await save();
  return { id: p.id, isNew, duplicate: !isNew && actions.length === 0, actions, errors };
}
// ---------------------------------------------------------------------------

// ===========================================================================
// POST /api/paypal-webhook — PayPal REST webhooks (live)
// Events: BILLING.SUBSCRIPTION.ACTIVATED, PAYMENT.SALE.COMPLETED,
//         PAYMENT.CAPTURE.COMPLETED, CHECKOUT.ORDER.COMPLETED
// ===========================================================================
async function verifyWebhookSignature(env, token, headers, raw) {
  const h = (n) => headers.get(n) || "";
  const parts = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
  };
  if (Object.values(parts).some((x) => !x)) return false;
  // Embed the raw event body verbatim (re-serialising can break verification).
  const body = "{" + Object.entries(parts).map(([k, val]) => JSON.stringify(k) + ":" + JSON.stringify(val)).join(",") +
    ',"webhook_id":' + JSON.stringify(env.PAYPAL_WEBHOOK_ID) + ',"webhook_event":' + raw + "}";
  const r = await fetch(PAYPAL_API + "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body,
  });
  if (!r.ok) { console.error("verify-webhook-signature http", r.status); return false; }
  const j = await r.json();
  return j && j.verification_status === "SUCCESS";
}

async function subscriptionContext(token, subId, fallback) {
  let sub = fallback || null;
  try { sub = await paypalGet(token, "/v1/billing/subscriptions/" + encodeURIComponent(subId)); } catch (e) { console.error(e.message); }
  sub = sub || {};
  let plan = null;
  if (sub.plan_id) { try { plan = await paypalGet(token, "/v1/billing/plans/" + encodeURIComponent(sub.plan_id)); } catch (e) { console.error(e.message); } }
  const pt = parseCustomId(sub.custom_id) || PLAN_MAP[sub.plan_id] || null;
  const pack = pt ? pt[0] : null;
  const tier = pt ? pt[1] : null;
  const cycles = (plan && plan.billing_cycles) || [];
  const regular = cycles.find((c) => c.tenure_type === "REGULAR");
  const trial = cycles.find((c) => c.tenure_type === "TRIAL");
  const setupFee = plan && plan.payment_preferences && plan.payment_preferences.setup_fee ? plan.payment_preferences.setup_fee.value : (pack ? PACKAGES[pack].price : null);
  const monthly = regular && regular.pricing_scheme && regular.pricing_scheme.fixed_price ? regular.pricing_scheme.fixed_price.value : (tier ? TIERS[tier].monthly : null);
  const trialMonths = trial ? (trial.total_cycles || 0) * ((trial.frequency && trial.frequency.interval_count) || 1) : (pack ? TRIAL_MONTHS[pack] : 0);
  const s = sub.subscriber || {};
  const nm = s.name || {};
  const payerName = [nm.given_name, nm.surname].filter(Boolean).join(" ");
  return { sub, plan, pack, tier, setupFee, monthly, trialMonths, payerName, firstName: nm.given_name || "", payerEmail: s.email_address || "", planName: plan && plan.name };
}

function careSentence(c) {
  const t = TIERS[c.tier].name;
  const months = c.trialMonths === 1 ? "your first month" : `your first ${c.trialMonths} months`;
  const html = `the <strong>${PACKAGES[c.pack].name}</strong> package (${usd(c.setupFee)} one-time) with the <strong>Care ${t}</strong> plan — ${c.trialMonths ? months + " of care is included, then " : ""}${usd(c.monthly)}/month, cancel anytime`;
  const text = `the ${PACKAGES[c.pack].name} package (${usd(c.setupFee)} one-time) with the Care ${t} plan (${c.trialMonths ? months + " of care included, then " : ""}${usd(c.monthly)}/month, cancel anytime)`;
  return { html, text };
}

async function onSubscriptionActivated(env, token, event) {
  const res = event.resource || {};
  const c = await subscriptionContext(token, res.id, res);
  const ours = !!(c.pack && c.tier);
  const item = ours ? careSentence(c) : null;
  return processPayment(env, {
    id: res.id,
    kind: ours ? "subscription" : "other",
    sendEmail: ours,
    payerName: c.payerName, payerEmail: c.payerEmail, firstName: c.firstName,
    emailItemHtml: item && item.html, emailItemText: item && item.text,
    titleKo: ours ? "🎉 새 결제 — 구독 시작 (Brightfront)" : "💳 PayPal 구독 시작 (Brightfront 플랜 아님)",
    amountKo: (c.setupFee != null ? usd(c.setupFee) + " USD 셋업비 (오늘)" : "-") + (c.monthly != null ? " + 월 " + usd(c.monthly) + (c.trialMonths ? ` (${c.trialMonths}개월 포함 후 과금)` : "") : ""),
    itemKo: ours ? `${PACKAGES[c.pack].name} + Care ${TIERS[c.tier].name}` : (c.planName || c.sub.plan_id || "-"),
    refLabel: "PayPal 구독 ID", refId: res.id,
    extraKo: [["플랜 ID", c.sub.plan_id]],
    memo: "",
    source: "PayPal webhook BILLING.SUBSCRIPTION.ACTIVATED",
  });
}

async function onSaleCompleted(env, token, event) {
  const sale = event.resource || {};
  const amt = sale.amount || {};
  const total = amt.total, cur = amt.currency || "USD";
  const subId = sale.billing_agreement_id;
  if (subId) {
    const c = await subscriptionContext(token, subId, null);
    const isSetupFee = c.setupFee != null && num(c.setupFee) > 0 && sameAmount(total, c.setupFee) && !sameAmount(total, c.monthly);
    const itemKo = c.pack && c.tier ? `${PACKAGES[c.pack].name} + Care ${TIERS[c.tier].name}` : (c.planName || c.sub.plan_id || "구독");
    if (isSetupFee) {
      // Setup fee at activation: already announced by BILLING.SUBSCRIPTION.ACTIVATED. Record only.
      return processPayment(env, {
        id: sale.id, kind: "setup_fee", sendEmail: false, notify: false,
        payerName: c.payerName, payerEmail: c.payerEmail, amount: total, currency: cur,
        itemKo, refLabel: "PayPal 거래 ID", refId: sale.id, source: "PayPal webhook PAYMENT.SALE.COMPLETED (setup fee)",
      });
    }
    return processPayment(env, {
      id: sale.id, kind: "recurring", sendEmail: false,
      payerName: c.payerName, payerEmail: c.payerEmail, amount: total, currency: cur,
      titleKo: "🔁 월 구독료 결제 완료",
      amountKo: amountText(total, cur), itemKo: itemKo + " (월 구독)",
      refLabel: "PayPal 거래 ID", refId: sale.id, extraKo: [["구독 ID", subId]],
      memo: "", source: "PayPal webhook PAYMENT.SALE.COMPLETED",
    });
  }
  // One-time (e.g. classic _xclick link). Payer details usually arrive via IPN (same txn id).
  const pack = packFromAmount(total);
  return processPayment(env, {
    id: sale.id, kind: "onetime", sendEmail: !!pack, amount: total, currency: cur,
    emailItemHtml: pack ? `the <strong>${PACKAGES[pack].name}</strong> package (${usd(total)}, one-time)` : "",
    emailItemText: pack ? `the ${PACKAGES[pack].name} package (${usd(total)}, one-time)` : "",
    titleKo: "💳 새 결제 — 일회성",
    amountKo: amountText(total, cur), itemKo: pack ? PACKAGES[pack].name + " (금액 기준 추정)" : "알 수 없음 (금액 기준 매칭 안 됨)",
    refLabel: "PayPal 거래 ID", refId: sale.id, memo: "",
    source: "PayPal webhook PAYMENT.SALE.COMPLETED",
  });
}

async function onOrderPayment(env, token, order, capture, eventType) {
  order = order || {};
  capture = capture || {};
  const pu = (order.purchase_units || [])[0] || {};
  const payer = order.payer || {};
  const nm = payer.name || {};
  const amount = capture.amount || pu.amount || {};
  const total = amount.value, cur = amount.currency_code || "USD";
  const desc = [pu.custom_id, pu.description, ...((pu.items || []).map((i) => i.name))].filter(Boolean).join(" ");
  const pack = packFromText(desc) || packFromAmount(total);
  const mentionsUs = /brightfront/i.test(desc) || (!desc && !!pack);
  const id = capture.id || order.id;
  const itemName = (pu.items && pu.items[0] && pu.items[0].name) || pu.description || "";
  return processPayment(env, {
    id, kind: "onetime", sendEmail: !!(pack && mentionsUs), amount: total, currency: cur,
    payerName: [nm.given_name, nm.surname].filter(Boolean).join(" "), firstName: nm.given_name || "",
    payerEmail: payer.email_address || "",
    emailItemHtml: pack ? `the <strong>${PACKAGES[pack].name}</strong> package (${usd(total)}, one-time)` : "",
    emailItemText: pack ? `the ${PACKAGES[pack].name} package (${usd(total)}, one-time)` : "",
    titleKo: "💳 새 결제 — 일회성 (PayPal 주문)",
    amountKo: amountText(total, cur), itemKo: itemName || (pack ? PACKAGES[pack].name : "-"),
    refLabel: "PayPal 거래 ID", refId: id, extraKo: [["주문 ID", order.id]],
    memo: pu.soft_descriptor ? "" : (order.note || ""),
    source: "PayPal webhook " + eventType,
  });
}

async function handleEvent(env, token, event) {
  const type = event.event_type;
  const res = event.resource || {};
  switch (type) {
    case "BILLING.SUBSCRIPTION.ACTIVATED":
      return onSubscriptionActivated(env, token, event);
    case "PAYMENT.SALE.COMPLETED":
      return onSaleCompleted(env, token, event);
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (res.status && res.status !== "COMPLETED") return { ignored: "capture status " + res.status };
      const orderId = res.supplementary_data && res.supplementary_data.related_ids && res.supplementary_data.related_ids.order_id;
      let order = null;
      if (orderId) { try { order = await paypalGet(token, "/v2/checkout/orders/" + encodeURIComponent(orderId)); } catch (e) { console.error(e.message); } }
      return onOrderPayment(env, token, order || { id: orderId }, res, type);
    }
    case "CHECKOUT.ORDER.COMPLETED": {
      const pu = (res.purchase_units || [])[0] || {};
      const cap = ((pu.payments && pu.payments.captures) || [])[0];
      if (cap && cap.status && cap.status !== "COMPLETED") return { ignored: "capture status " + cap.status };
      return onOrderPayment(env, token, res, cap, type);
    }
    default:
      return { ignored: type || "unknown" };
  }
}

export async function onRequestPost({ request, env }) {
  const raw = await request.text();
  let event;
  try { event = JSON.parse(raw); } catch (_) { return jsonResponse({ ok: false, error: "bad json" }, 400); }
  const missing = ["PAYPAL_CLIENT_ID", "PAYPAL_SECRET", "PAYPAL_WEBHOOK_ID"].filter((k) => !env[k]);
  if (missing.length) { console.error("paypal-webhook: missing env", missing.join(",")); return jsonResponse({ ok: false, error: "not configured" }, 503); }
  let token;
  try { token = await paypalToken(env); } catch (e) { console.error(e.message); return jsonResponse({ ok: false, error: "paypal auth" }, 502); }
  let verified = false;
  try { verified = await verifyWebhookSignature(env, token, request.headers, raw); } catch (e) { console.error("verify error", e.message); }
  if (!verified) { console.warn("paypal-webhook: signature verification FAILED", event && event.id); return jsonResponse({ ok: false, error: "signature verification failed" }, 401); }
  try {
    const result = await handleEvent(env, token, event);
    console.log("paypal-webhook", event.event_type, event.id, JSON.stringify(result));
    if (result && result.errors && result.errors.length) return jsonResponse({ ok: false, result }, 500); // PayPal will retry
    return jsonResponse({ ok: true, result });
  } catch (e) {
    console.error("paypal-webhook handler error", e && e.message);
    return jsonResponse({ ok: false, error: "handler error" }, 500);
  }
}
