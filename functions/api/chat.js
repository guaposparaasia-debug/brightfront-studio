// functions/api/chat.js
const PRIMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CONTACT_EMAIL = "info@brightfrontdesign.com";
const CHAT_TTL = 60 * 24 * 60 * 60;
const LEAD_TTL = 90 * 24 * 60 * 60;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const SYSTEM_PROMPT = `You are the Brightfront Studio assistant, a friendly website-studio helper for small businesses. Reply in English only. Be warm, clear, and concise: 2–4 sentences. No markdown headings, no bullet walls.

Facts you may use, and NOTHING else:
- Brightfront Studio builds websites for small businesses: cafes, restaurants, salons, clinics, shops, and local services.
- Services: website design, landing pages, online booking/menus, local SEO and Google Business setup, maintenance and hosting.
- How it works: we build a FREE homepage preview first. The client reviews it and requests tweaks. They pay only if they love it. Then we finish and launch.
- Packages: Starter from $299, Business from $699, Premium from $1,299.
- Optional monthly care plans (cancel anytime in PayPal): Basic $19/mo (2 small edits/month, hosting, SSL, uptime check), Standard $39/mo (5 edits/month, banner and photo swaps, seasonal menu/price updates), Pro $69/mo (unlimited small edits, 1 new page/month, monthly report). Edits done within 48 hours; unused edits don't roll over; the site and domain stay the client's. The first month of care is free (first 3 months with Premium). Subscribing to care through PayPal may require a PayPal account in some countries.
- Payment is after they approve the preview, via PayPal (cards accepted) or Apple Cash for US customers. Once payment is confirmed we complete and launch the site right away.
- Contact email: ${CONTACT_EMAIL}.

Never invent timelines, guarantees, discounts, past clients, reviews, or phone numbers. If you are unsure, say the team can follow up by email at ${CONTACT_EMAIL}.

Main goal: answer helpfully, then invite the visitor to request a free preview by sharing their name, business name, what they sell, city, current website/Instagram/Facebook if any, and email.`;

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  let siteOrigin = "";
  try {
    siteOrigin = new URL(request.url).origin;
  } catch {
    siteOrigin = "";
  }
  const allow = new Set(
    [siteOrigin, "https://brightfrontdesign.com", "https://www.brightfrontdesign.com", "https://brightfront-studio.pages.dev"].filter(Boolean)
  );
  return allow.has(origin) ? origin : null;
}

function corsHeaders(request) {
  const origin = allowedOrigin(request);
  const headers = { Vary: "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function fallbackReply() {
  return `Sorry, I could not answer just now. Email ${CONTACT_EMAIL} with your name, business, city, and what you sell, and the team will send a free homepage preview.`;
}

function extractReply(result) {
  if (!result) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result.response === "string") return result.response.trim();
  if (typeof result.result === "string") return result.result.trim();
  if (result.result && typeof result.result.response === "string") {
    return result.result.response.trim();
  }
  return "";
}

async function runModel(env, model, messages) {
  const result = await env.AI.run(model, {
    messages,
    max_tokens: 400,
  });
  const reply = extractReply(result);
  if (!reply) throw new Error("empty model reply");
  return reply;
}

export async function onRequest(context) {
  const { request } = context;
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") {
    if (!headers["Access-Control-Allow-Origin"]) return new Response(null, { status: 403, headers });
    return new Response(null, { status: 204, headers });
  }
  if (request.method === "POST") return onRequestPost(context);
  return json({ error: "Method not allowed" }, 405, headers);
}

export async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request);
  if (request.headers.get("Origin") && !headers["Access-Control-Allow-Origin"]) {
    return json({ error: "Origin not allowed" }, 403, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, headers);
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const incoming = Array.isArray(body.messages) ? body.messages : null;
  if (!sessionId || sessionId.length > 64 || !incoming || incoming.length === 0 || incoming.length > 20) {
    return json({ error: "Invalid session or messages" }, 400, headers);
  }

  const messages = [];
  for (const item of incoming) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) {
      return json({ error: "Invalid message role" }, 400, headers);
    }
    if (typeof item.content !== "string" || item.content.length === 0 || item.content.length > 1000) {
      return json({ error: "Invalid message content" }, 400, headers);
    }
    messages.push({ role: item.role, content: item.content });
  }

  const modelMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
  let reply = "";
  try {
    if (!env.AI) throw new Error("AI binding missing");
    try {
      reply = await runModel(env, PRIMARY_MODEL, modelMessages);
    } catch {
      reply = await runModel(env, FALLBACK_MODEL, modelMessages);
    }
  } catch {
    reply = fallbackReply();
  }

  const stored = [...messages, { role: "assistant", content: reply }];
  const updatedAt = new Date().toISOString();
  const record = { sessionId, updatedAt, messages: stored };

  try {
    if (env.LEADS) {
      await env.LEADS.put(`chat:${sessionId}`, JSON.stringify(record), { expirationTtl: CHAT_TTL });
      const emailHit = stored
        .filter((m) => m.role === "user")
        .map((m) => m.content.match(EMAIL_RE))
        .find(Boolean);
      if (emailHit) {
        await env.LEADS.put(
          `lead:${sessionId}`,
          JSON.stringify({
            sessionId,
            email: emailHit[0],
            updatedAt,
            messages: stored,
            page: request.headers.get("referer") || request.headers.get("referrer") || "",
          }),
          { expirationTtl: LEAD_TTL }
        );
      }
    }
  } catch {
    // Keep the reply even if KV is unavailable.
  }

  return json({ reply }, 200, headers);
}
