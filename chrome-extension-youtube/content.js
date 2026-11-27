(() => {
  const root = document.documentElement;
  let settings = { ...YTC_DEFAULTS };

  function apply() {
    const on = settings.enabled;
    for (const { key } of YTC_OPTIONS) {
      root.toggleAttribute("data-ytc-" + key, on && !!settings[key]);
    }
    redirectShorts();
  }

  function redirectShorts() {
    if (!settings.enabled || !settings.redirect) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]{6,})/);
    if (m) location.replace(location.origin + "/watch?v=" + m[1] + location.search.replace(/^\?/, "&"));
  }

  chrome.storage.sync.get(YTC_DEFAULTS, (stored) => {
    settings = { ...YTC_DEFAULTS, ...stored };
    apply();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    apply();
  });

  // YouTube is a single-page app: catch in-app navigation to /shorts/.
  document.addEventListener("yt-navigate-start", redirectShorts);
  document.addEventListener("yt-navigate-finish", redirectShorts);
  window.addEventListener("popstate", redirectShorts);
})();
