// functions/api/chat.js
const PRIMARY_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CONTACT_EMAIL = "info@brightfrontdesign.com";
const CHAT_TTL = 60 * 24 * 60 * 60;
const LEAD_TTL = 90 * 24 * 60 * 60;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

const SYSTEM_PROMPT = `You are the Brightfront Studio assistant, a friendly helper for small businesses. Reply in the visitor's language if they write in Spanish, Korean, Japanese, Chinese, Filipino, Vietnamese or Arabic; otherwise reply in English. Be warm, clear, and concise: 2–4 sentences. No markdown headings, no bullet walls. Ask at most one or two questions per reply.

Brightfront Studio offers TWO services. Facts you may use, and NOTHING else:

1) WEBSITES for small businesses (cafes, restaurants, salons, clinics, shops, food trucks, local services).
- Services: website design, landing pages, online booking/menus, local SEO and Google Business setup, maintenance and hosting.
- How it works: we build a FREE homepage preview first. The client reviews it and requests tweaks. They pay only if they love it. Then we finish and launch.
- Pricing: $59 one-time setup, then $29/month (locked). Payment via PayPal (cards accepted). Cancel anytime.
- Never mention any other website price, package, discount, sale, or care plan.
- Domain setup add-on: $49 plus the domain cost (usually $10–15/year).
- Payment is after they approve the preview.

2) CUSTOM BUSINESS SOFTWARE / TOOLS for small businesses.
- Examples: online booking/appointment systems, order and inventory trackers, customer lists (CRM) with reminders, automated email/SMS/Telegram notifications, invoices and quotes, staff schedules, simple dashboards and reports, AI chat assistants for their website.
- How it works: (1) they tell us the problem, (2) we build a FREE mini demo, (3) we launch it and offer optional monthly care.
- The consultation and the mini demo are free.
- Pricing: custom quote, starting from $499 for simple tools; monthly care available. Never quote a final price for software; say the team will send a custom quote.

Contact email: ${CONTACT_EMAIL}.

Never invent timelines, guarantees, discounts, past clients, reviews, or phone numbers. If you are unsure, say the team can follow up by email at ${CONTACT_EMAIL}.

Lead collection (main goal): answer helpfully, then gently collect details so the team can follow up. Ask for them a little at a time, not all at once.
- For a website preview: name, business name, what they sell, city, current website/Instagram/Facebook if any, and email.
- For software: name, business name and type, the problem or task they want to solve, the tools they use today (e.g. spreadsheets, paper, WhatsApp), rough number of staff or customers, any deadline or budget range, and email (phone optional).
When you have their email, confirm that the team will reply by email, usually with a free preview (websites) or a free consultation and mini demo (software).`;

const SOFTWARE_RE = /software|app\b|tool|system|booking|appointment|inventory|stock|crm|customer list|reminder|invoice|quote|schedul|shift|dashboard|report|automat|notification|telegram|sms|chatbot|ai chat|소프트웨어|업무 툴|예약 시스템|재고|ソフト|ツール|在庫|予約システム|软件|系统|库存|برمج|نظام/i;

function detectInterest(messages) {
  const text = messages.filter((m) => m.role === "user").map((m) => m.content).join(" \n ");
  return SOFTWARE_RE.test(text) ? "software" : "website";
}

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
  return `Sorry, I could not answer just now. Email ${CONTACT_EMAIL} with your name, business, city, and what you sell, and the team will send a free homepage preview or a free software consultation.`;
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
            interest: detectInterest(stored),
            updatedAt,
            messages: stored,
            page: request.headers.get("referer") || request.headers.get("referrer") || "",
          }),
          { expirationTtl: LEAD_TTL }
        );
        const seenKey = `leadalert:${sessionId}`;
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID && !(await env.LEADS.get(seenKey))) {
          await env.LEADS.put(seenKey, "1", { expirationTtl: LEAD_TTL });
          const lastUser = (stored.filter((m) => m.role === "user").pop() || {}).content || "";
          await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, disable_web_page_preview: true,
              text: ("💬 Chat lead (Brightfront): " + emailHit[0] + "\nInterest: " + detectInterest(stored) +
                "\nPage: " + (request.headers.get("referer") || "-") + "\nLast msg: " + lastUser + "\nKV: lead:" + sessionId).slice(0, 4000) }),
          }).catch(() => {});
        }
      }
    }
  } catch {
    // Keep the reply even if KV is unavailable.
  }

  return json({ reply }, 200, headers);
}
