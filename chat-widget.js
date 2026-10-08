// chat-widget.js
(function () {
  if (window.__brightfrontChat) return;
  window.__brightfrontChat = true;

  var STORAGE_ID = "bf_chat_session";
  var STORAGE_MSGS = "bf_chat_messages";
  var GREETING =
    "Hi! 👋 Want a free homepage preview for your business? Ask me anything about pricing or how it works.";
  var CHIPS = [
    "How does the free preview work?",
    "How much does it cost?",
    "I want a free preview",
  ];

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadSession() {
    try {
      var id = localStorage.getItem(STORAGE_ID);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(STORAGE_ID, id);
      }
      return id;
    } catch (e) {
      return crypto.randomUUID();
    }
  }

  function loadMessages() {
    try {
      var raw = localStorage.getItem(STORAGE_MSGS);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (m) {
        return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
      });
    } catch (e) {
      return [];
    }
  }

  function saveMessages(messages) {
    try {
      localStorage.setItem(STORAGE_MSGS, JSON.stringify(messages.slice(-20)));
    } catch (e) {}
  }

  var css = document.createElement("style");
  css.textContent =
    ".bf-chat-btn{position:fixed;right:20px;bottom:20px;z-index:9998;width:60px;height:60px;border:0;border-radius:999px;background:#1b1a17;color:#f6f1e7;box-shadow:0 10px 28px rgba(27,26,23,.28);cursor:pointer;display:flex;align-items:center;justify-content:center}" +
    ".bf-chat-btn:focus-visible,.bf-send:focus-visible,.bf-chip:focus-visible,.bf-close:focus-visible,.bf-input:focus-visible{outline:2px solid #c2410c;outline-offset:2px}" +
    ".bf-panel{position:fixed;right:20px;bottom:92px;z-index:9999;width:min(380px,calc(100vw - 24px));height:min(560px,calc(100vh - 120px));background:#f7f3ec;color:#1b1a17;border:1px solid #e6dfd2;border-radius:18px;box-shadow:0 18px 50px rgba(27,26,23,.22);display:none;flex-direction:column;overflow:hidden;font:15px/1.45 Georgia, 'Iowan Old Style', serif}" +
    ".bf-panel.bf-open{display:flex}" +
    ".bf-head{background:#1b1a17;color:#f6f1e7;padding:14px 14px 12px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}" +
    ".bf-head strong{display:block;font-size:15px;letter-spacing:.01em}" +
    ".bf-head span{display:block;margin-top:3px;font:12px/1.3 system-ui,sans-serif;color:#e7d3c4}" +
    ".bf-close{background:transparent;border:0;color:#f6f1e7;font-size:22px;line-height:1;cursor:pointer;padding:0 2px}" +
    ".bf-log{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".bf-msg{max-width:86%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word}" +
    ".bf-msg.bf-bot{background:#fff;border:1px solid #eadfce;align-self:flex-start}" +
    ".bf-msg.bf-user{background:#1b1a17;color:#f6f1e7;align-self:flex-end}" +
    ".bf-chips{display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 10px}" +
    ".bf-chip{border:1px solid #e4d5c4;background:#fff;color:#1b1a17;border-radius:999px;padding:7px 10px;font:12px/1.2 system-ui,sans-serif;cursor:pointer}" +
    ".bf-chip:hover{border-color:#c2410c;color:#c2410c}" +
    ".bf-typing{align-self:flex-start;background:#fff;border:1px solid #eadfce;border-radius:14px;padding:10px 12px;display:none}" +
    ".bf-typing.bf-on{display:inline-flex;gap:4px}" +
    ".bf-typing i{width:6px;height:6px;border-radius:50%;background:#c2410c;display:block;animation:bf-blink 1s infinite}" +
    ".bf-typing i:nth-child(2){animation-delay:.15s}.bf-typing i:nth-child(3){animation-delay:.3s}" +
    "@keyframes bf-blink{0%,80%,100%{opacity:.25}40%{opacity:1}}" +
    ".bf-form{display:flex;gap:8px;padding:12px;border-top:1px solid #e6dfd2;background:#fffdf9}" +
    ".bf-input{flex:1;border:1px solid #e4d5c4;border-radius:12px;padding:10px 12px;font:14px/1.3 system-ui,sans-serif;color:#1b1a17;background:#fff}" +
    ".bf-send{border:0;border-radius:12px;background:#c2410c;color:#fff;padding:0 14px;font:14px/1 system-ui,sans-serif;cursor:pointer}" +
    ".bf-send:disabled{opacity:.55;cursor:default}" +
    "@media (max-width:640px){.bf-panel{right:0;bottom:0;width:100%;height:100%;border-radius:0}.bf-chat-btn{right:14px;bottom:14px}}";
  document.head.appendChild(css);

  var root = document.createElement("div");
  root.innerHTML =
    '<button class="bf-chat-btn" type="button" aria-label="Open chat" aria-expanded="false" aria-controls="bf-chat-panel">' +
    '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v6A3.5 3.5 0 0 1 15.5 16H12l-4.2 3.2c-.7.5-1.8 0-1.8-.9V16A3.5 3.5 0 0 1 5 12.5v-6Z"/></svg>' +
    "</button>" +
    '<section class="bf-panel" id="bf-chat-panel" role="dialog" aria-modal="false" aria-labelledby="bf-chat-title" hidden>' +
    '<div class="bf-head"><div><strong id="bf-chat-title">Brightfront Studio · Chat with us</strong><span>Usually replies instantly</span></div>' +
    '<button class="bf-close" type="button" aria-label="Close chat">×</button></div>' +
    '<div class="bf-log" role="log" aria-live="polite" aria-relevant="additions"></div>' +
    '<div class="bf-chips"></div>' +
    '<form class="bf-form"><input class="bf-input" type="text" maxlength="1000" aria-label="Message" placeholder="Ask about pricing or a free preview" /><button class="bf-send" type="submit">Send</button></form>' +
    "</section>";
  document.body.appendChild(root);

  var button = root.querySelector(".bf-chat-btn");
  var panel = root.querySelector(".bf-panel");
  var closeBtn = root.querySelector(".bf-close");
  var log = root.querySelector(".bf-log");
  var chips = root.querySelector(".bf-chips");
  var form = root.querySelector(".bf-form");
  var input = root.querySelector(".bf-input");
  var send = root.querySelector(".bf-send");
  var sessionId = loadSession();
  var messages = loadMessages();
  var busy = false;

  CHIPS.forEach(function (label) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "bf-chip";
    chip.textContent = label;
    chip.addEventListener("click", function () {
      sendText(label);
    });
    chips.appendChild(chip);
  });

  function addBubble(role, content) {
    var el = document.createElement("div");
    el.className = "bf-msg " + (role === "user" ? "bf-user" : "bf-bot");
    el.innerHTML = esc(content);
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  var typing = document.createElement("div");
  typing.className = "bf-typing";
  typing.setAttribute("aria-label", "Assistant is typing");
  typing.innerHTML = "<i></i><i></i><i></i>";
  log.appendChild(typing);

  if (!messages.length) addBubble("assistant", GREETING);
  messages.forEach(function (m) {
    addBubble(m.role, m.content);
  });
  log.appendChild(typing);

  function setOpen(open) {
    panel.hidden = !open;
    panel.classList.toggle("bf-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) input.focus();
  }

  button.addEventListener("click", function () {
    setOpen(panel.hidden);
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
    button.focus();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });

  function sendText(text) {
    var content = text.trim();
    if (!content || busy || content.length > 1000) return;
    busy = true;
    send.disabled = true;
    messages.push({ role: "user", content: content });
    saveMessages(messages);
    addBubble("user", content);
    input.value = "";
    typing.classList.add("bf-on");
    log.scrollTop = log.scrollHeight;

    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionId, messages: messages.slice(-20) }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("bad status");
        return res.json();
      })
      .then(function (data) {
        var reply =
          data && typeof data.reply === "string" && data.reply
            ? data.reply
            : "Sorry, I could not answer just now. Email guaposparaasia@gmail.com and the team will follow up.";
        messages.push({ role: "assistant", content: reply });
        saveMessages(messages);
        addBubble("assistant", reply);
      })
      .catch(function () {
        var reply =
          "Sorry, I could not answer just now. Email guaposparaasia@gmail.com with your name, business, and city for a free homepage preview.";
        messages.push({ role: "assistant", content: reply });
        saveMessages(messages);
        addBubble("assistant", reply);
      })
      .then(function () {
        typing.classList.remove("bf-on");
        busy = false;
        send.disabled = false;
        input.focus();
      });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    sendText(input.value);
  });
})();
