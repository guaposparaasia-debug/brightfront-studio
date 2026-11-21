// IndexNow key file: /b8eab379ece0edfb0fa8c1bc801e54a3.txt (site root; its body is the key). The key is public by design, not a secret.
// Usage (after a deploy): node scripts/indexnow-ping.mjs        -> submits every <loc> in sitemap.xml
//                         node scripts/indexnow-ping.mjs --dry  -> prints the payload only
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOST = "brightfrontdesign.com";
const KEY = "b8eab379ece0edfb0fa8c1bc801e54a3";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const keyFile = readFileSync(join(root, KEY + ".txt"), "utf8").trim();
if (keyFile !== KEY) throw new Error("Key file content does not match KEY");

const sitemap = readFileSync(join(root, "sitemap.xml"), "utf8");
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim())
  .filter((u) => new URL(u).hostname === HOST && !/\/(preview|thanks)\//.test(u));

const body = { host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList };
if (process.argv.includes("--dry")) { console.log(JSON.stringify(body, null, 2)); process.exit(0); }

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});
console.log("IndexNow:", res.status, res.statusText, "-", urlList.length, "URLs");
if (!res.ok && res.status !== 202) process.exit(1);
