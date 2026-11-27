# YouTube Clean View (Chrome extension)

Hides the distracting parts of YouTube. Each part has its own toggle in the toolbar popup,
and a master switch turns everything off at once. Settings sync across your Chrome profile.

| Toggle | What it hides | Default |
|---|---|---|
| Hide Shorts | Shorts shelves, the Shorts sidebar link and tab, Shorts in search and feeds | On |
| Open Shorts as normal videos | Redirects `/shorts/ID` to `/watch?v=ID` | On |
| Hide home page feed | The recommended grid on the home page | Off |
| Hide recommendations sidebar | The "Up next" list beside a video | On |
| Hide comments | The comment section | Off |
| Hide end screens & cards | The end-of-video wall and pop-up cards on the player | On |
| Hide promoted cards | Sponsored tiles, promo banners, masthead promos | On |
| Hide topic chips | The filter pills above feeds | Off |

It only hides page elements with CSS. It does not block network requests or skip video ads.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `chrome-extension-youtube` folder.
4. Pin the extension and click its icon to change toggles. Changes apply instantly, no reload.

## Files

- `manifest.json`: Manifest V3, only the `storage` permission plus YouTube host access.
- `settings.js`: the list of toggles and their defaults (shared by popup and content script).
- `content.js`: reads settings, sets `data-ytc-*` attributes on `<html>`, handles the Shorts redirect.
- `clean.css`: the hide rules, each gated by one of those attributes.
- `popup.html`, `popup.css`, `popup.js`: the toolbar popup.

YouTube renames its elements from time to time. If something starts showing again,
add the new element's selector to the matching block in `clean.css`.
