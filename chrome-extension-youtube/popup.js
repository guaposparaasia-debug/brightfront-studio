const list = document.getElementById("options");
const master = document.getElementById("enabled");

for (const { key, label, hint } of YTC_OPTIONS) {
  const li = document.createElement("li");
  li.innerHTML = `
    <label class="text" for="opt-${key}">${label}${hint ? `<span class="hint">${hint}</span>` : ""}</label>
    <label class="switch"><input type="checkbox" id="opt-${key}" data-key="${key}"><span class="slider"></span></label>`;
  list.appendChild(li);
}

function render(s) {
  master.checked = s.enabled;
  document.body.classList.toggle("off", !s.enabled);
  for (const input of list.querySelectorAll("input[data-key]")) input.checked = !!s[input.dataset.key];
}

chrome.storage.sync.get(YTC_DEFAULTS, render);

master.addEventListener("change", () => {
  document.body.classList.toggle("off", !master.checked);
  chrome.storage.sync.set({ enabled: master.checked });
});

list.addEventListener("change", (e) => {
  const key = e.target.dataset.key;
  if (key) chrome.storage.sync.set({ [key]: e.target.checked });
});

document.getElementById("reset").addEventListener("click", () => {
  chrome.storage.sync.set(YTC_DEFAULTS, () => render(YTC_DEFAULTS));
});
