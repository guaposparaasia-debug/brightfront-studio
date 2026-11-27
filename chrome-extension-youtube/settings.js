// Shared by the content script and the popup.
// Each key becomes a data attribute on <html> (data-ytc-<key>) that clean.css hooks into.
const YTC_OPTIONS = [
  { key: "shorts",    label: "Hide Shorts",                  hint: "Shelves, sidebar link, Shorts in search and feeds" },
  { key: "redirect",  label: "Open Shorts as normal videos", hint: "/shorts/ID becomes /watch?v=ID" },
  { key: "home",      label: "Hide home page feed",          hint: "Search bar and subscriptions still work" },
  { key: "related",   label: "Hide recommendations sidebar", hint: "The 'Up next' list beside a video" },
  { key: "comments",  label: "Hide comments",                hint: "" },
  { key: "endscreen", label: "Hide end screens & cards",     hint: "Video wall and pop-up cards over the player" },
  { key: "promoted",  label: "Hide promoted cards",          hint: "Sponsored tiles, banners and masthead promos" },
  { key: "chips",     label: "Hide topic chips",             hint: "The filter pills above feeds" }
];

const YTC_DEFAULTS = {
  enabled: true,
  shorts: true,
  redirect: true,
  home: false,
  related: true,
  comments: false,
  endscreen: true,
  promoted: true,
  chips: false
};
