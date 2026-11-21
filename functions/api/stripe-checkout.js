// Brightfront Studio — Stripe Checkout (Cloudflare Pages Function)
// ---------------------------------------------------------------------------
// Creates a Stripe Checkout Session for one of the three website payments and
// returns its URL. PayPal stays available; this is the card/Stripe alternative.
//
//   plan "start"       — $250 one-time, starts the website build
//   plan "approval"    — $250 one-time, after the client approves the finished site
//   plan "maintenance" — $39/month subscription (hosting, updates and changes)
//
// POST /api/stripe-checkout  JSON { plan, email?, business?, ref? }  -> { url }
//   (used by the buttons on the homepage)
// GET  /api/stripe-checkout?plan=approval&email=...  -> 303 redirect to Checkout
//   (a link the owner can email to a client, e.g. for the $250 approval payment)
//
// Secrets come only from env: STRIPE_SECRET_KEY (required).
// Optional env: STRIPE_PRICE_START, STRIPE_PRICE_APPROVAL, STRIPE_PRICE_MAINTENANCE
// (Stripe Price IDs). When a price ID is not set, the amount below is sent inline
// as price_data, so no Stripe product setup is required.
// ---------------------------------------------------------------------------
const STRIPE_API = "https://api.stripe.com/v1";
const SITE = "https://brightfrontdesign.com";
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const PLANS = {
  start: {
    mode: "payment", amount: 25000, priceEnv: "STRIPE_PRICE_START",
    name: "Brightfront website — first payment (start build)",
    description: "$250 upfront so we start building your website.",
  },
  approval: {
    mode: "payment", amount: 25000, priceEnv: "STRIPE_PRICE_APPROVAL",
    name: "Brightfront website — second payment (after approval)",
    description: "$250 after the website is finished and you approve it.",
  },
  maintenance: {
    mode: "subscription", amount: 3900, interval: "month", priceEnv: "STRIPE_PRICE_MAINTENANCE",
    name: "Brightfront Studio website maintenance - $39/month",
    description: "Hosting, updates and changes for your website. Cancel anytime.",
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(headers || {}) },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  let self = "";
  try { self = new URL(request.url).origin; } catch (_) {}
  const allow = new Set([self, SITE, "https://www.brightfrontdesign.com", "https://brightfront-studio.pages.dev"].filter(Boolean));
  return allow.has(origin) ? origin : null;
}

function clean(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

// Base URL for success/cancel pages: the site itself, or the preview deployment it was opened from.
function baseUrl(request) {
  try {
    const u = new URL(request.url);
    if (u.hostname === "brightfrontdesign.com" || u.hostname === "www.brightfrontdesign.com" || u.hostname.endsWith(".brightfront-studio.pages.dev") || u.hostname === "brightfront-studio.pages.dev") return u.origin;
  } catch (_) {}
  return SITE;
}

async function createSession(env, request, input) {
  const planKey = clean(input.plan, 20).toLowerCase();
  const plan = PLANS[planKey];
  if (!plan) return { status: 400, body: { ok: false, error: "plan" } };
  if (!env.STRIPE_SECRET_KEY) { console.error("stripe-checkout: STRIPE_SECRET_KEY missing"); return { status: 503, body: { ok: false, error: "not configured" } }; }

  const email = clean(input.email, 120);
  const business = clean(input.business, 64);
  const ref = clean(input.ref, 120);
  if (planKey === "maintenance" && !business) return { status: 400, body: { ok: false, error: "business" } };

  const base = baseUrl(request);
  const p = new URLSearchParams();
  p.set("mode", plan.mode);
  p.set("success_url", base + "/thanks/?paid=stripe&session_id={CHECKOUT_SESSION_ID}");
  p.set("cancel_url", base + "/");
  p.set("line_items[0][quantity]", "1");
  const priceId = clean(env[plan.priceEnv], 100);
  if (priceId) {
    p.set("line_items[0][price]", priceId);
  } else {
    p.set("line_items[0][price_data][currency]", "usd");
    p.set("line_items[0][price_data][unit_amount]", String(plan.amount));
    p.set("line_items[0][price_data][product_data][name]", plan.name);
    p.set("line_items[0][price_data][product_data][description]", plan.description);
    if (plan.interval) p.set("line_items[0][price_data][recurring][interval]", plan.interval);
  }
  if (EMAIL_RE.test(email)) p.set("customer_email", email);
  const meta = { brightfront_plan: planKey, request_email: email, business, ref };
  for (const [k, v] of Object.entries(meta)) {
    if (!v) continue;
    p.set("metadata[" + k + "]", v);
    if (plan.mode === "subscription") p.set("subscription_data[metadata][" + k + "]", v);
    else p.set("payment_intent_data[metadata][" + k + "]", v);
  }
  if (plan.mode === "payment") {
    p.set("payment_intent_data[description]", plan.name);
    p.set("customer_creation", "always");
    p.set("invoice_creation[enabled]", "true");
  } else {
    p.set("subscription_data[description]", plan.name);
  }

  const r = await fetch(STRIPE_API + "/checkout/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: p.toString(),
  });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!r.ok || !j || !j.url) {
    console.error("stripe-checkout: create failed", r.status, j && j.error && (j.error.code || j.error.type));
    return { status: 502, body: { ok: false, error: "stripe" } };
  }
  return { status: 200, body: { ok: true, url: j.url, plan: planKey } };
}

export async function onRequestOptions({ request }) {
  const origin = allowedOrigin(request);
  const headers = { Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigin(request)) return json({ ok: false, error: "origin" }, 403);
  const headers = origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
  let input = {};
  try { input = await request.json(); } catch (_) { return json({ ok: false, error: "bad json" }, 400, headers); }
  try {
    const res = await createSession(env, request, input || {});
    return json(res.body, res.status, headers);
  } catch (e) {
    console.error("stripe-checkout error", e && e.message);
    return json({ ok: false, error: "error" }, 500, headers);
  }
}

export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  try {
    const res = await createSession(env, request, { plan: q.get("plan"), email: q.get("email"), business: q.get("business"), ref: q.get("ref") });
    if (res.status === 200) return Response.redirect(res.body.url, 303);
    return new Response("Sorry, the card payment page could not be opened. Please email info@brightfrontdesign.com.", {
      status: res.status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("stripe-checkout GET error", e && e.message);
    return new Response("error", { status: 500 });
  }
}
