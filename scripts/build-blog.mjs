// Builds the English blog ("Second Act") at /blog/.
// Sources: scripts/blog-posts/<slug>.html, each starting with a JSON front-matter comment:
//   <!--{ "title": ..., "description": ..., ... }-->  followed by the article body HTML.
// Output: blog/<slug>/index.html, blog/index.html, blog/about/index.html, blog/feed.xml,
//         and the blog block inside sitemap.xml (between <!-- blog:start --> and <!-- blog:end -->).
// Usage: node scripts/build-blog.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "scripts", "blog-posts");
const OUT = join(root, "blog");
const SITE = "https://brightfrontdesign.com";
const BLOG = "Second Act";
const BLOG_TAG = "Starting and running a small business after 40";
const ADSENSE = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1521418120439711" crossorigin="anonymous"></script>`;
const CSS_V = { pages: 3, blog: 3 };

const IMAGES = {
  "/img/07-team.webp": { w: 1200, h: 675, set: "/img/07-team-800w.webp 800w, /img/07-team-1200w.webp 1200w", src: "/img/07-team-1200w.webp" },
  "/img/02-websites.webp": { w: 1200, h: 675, set: "/img/02-websites-800w.webp 800w, /img/02-websites-1200w.webp 1200w", src: "/img/02-websites-1200w.webp" },
  "/img/01-hero.webp": { w: 1200, h: 675, set: "/img/01-hero-800w.webp 800w, /img/01-hero-1200w.webp 1200w", src: "/img/01-hero-1200w.webp" },
  "/img/04-cafe.webp": { w: 800, h: 450, set: "/img/04-cafe-480w.webp 480w, /img/04-cafe-800w.webp 800w", src: "/img/04-cafe-800w.webp" },
  "/img/05-salon.webp": { w: 800, h: 450, set: "/img/05-salon-480w.webp 480w, /img/05-salon-800w.webp 800w", src: "/img/05-salon-800w.webp" },
  "/img/06-foodtruck.webp": { w: 800, h: 450, set: "/img/06-foodtruck-480w.webp 480w, /img/06-foodtruck-800w.webp 800w", src: "/img/06-foodtruck-800w.webp" },
  "/img/store-crafts.webp": { w: 800, h: 533, set: "/img/store-crafts-480w.webp 480w, /img/store-crafts-800w.webp 800w", src: "/img/store-crafts-800w.webp" },
  "/img/store-food.webp": { w: 800, h: 533, set: "/img/store-food-480w.webp 480w, /img/store-food-800w.webp 800w", src: "/img/store-food-800w.webp" },
  "/img/08-phone.webp": { w: 752, h: 941, set: "/img/08-phone-480w.webp 480w, /img/08-phone.webp 752w", src: "/img/08-phone.webp" },
  "/img/store-beauty.webp": { w: 800, h: 533, set: "/img/store-beauty-480w.webp 480w, /img/store-beauty-800w.webp 800w", src: "/img/store-beauty-800w.webp" },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const strip = (s) => s.replace(/<[^>]+>/g, "");
const slugify = (s) => strip(s).toLowerCase().replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const json = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

const ICON = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231C3D34'/%3E%3Cpath fill='%23F6F3EC' d='M6 22.6V12.2L16 5.6l10 6.6v10.4H6z'/%3E%3Crect x='13.2' y='15.2' width='5.6' height='7.4' fill='%231C3D34'/%3E%3C/svg%3E">`;
const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#1C3D34"/><path fill="#F6F3EC" d="M6 22.6V12.2L16 5.6l10 6.6v10.4H6z"/><rect x="13.2" y="15.2" width="5.6" height="7.4" fill="#1C3D34"/></svg>`;

function head({ title, description, url, type = "website", image, imageAlt, schema = [], noImage = false }) {
  const img = SITE + (image ? imgInfo(image).src : "/img/blog/how-to-start-a-business-after-40-1200w.webp");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${url}">
  <link rel="alternate" type="application/rss+xml" title="${BLOG} by Brightfront Studio" href="${SITE}/blog/feed.xml">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Brightfront Studio">
  <meta property="og:locale" content="en_US">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
${noImage ? "" : `  <meta property="og:image" content="${img}">
  <meta property="og:image:alt" content="${esc(imageAlt || "Brightfront Studio")}">
`}  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#F6F3EC">
  ${ICON}
  <link rel="preload" href="/assets/fonts/instrument-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/pages.css?v=${CSS_V.pages}">
  <link rel="stylesheet" href="/assets/css/blog.css?v=${CSS_V.blog}">
${schema.map((s) => `  <script type="application/ld+json">${json(s)}</script>`).join("\n")}
  ${ADSENSE}
</head>
<body class="blog">
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap bar">
      <a class="brand" href="/">${LOGO}<span>Brightfront Studio</span></a>
      <nav class="top-nav" aria-label="Primary">
        <a href="/blog/">Blog</a><a href="/blog/about/">About the blog</a><a href="/resources/">Website guides</a><a href="/#pricing">Pricing</a><a class="btn" href="/#contact">Get my website</a>
      </nav>
    </div>
  </header>
  <main id="main">`;
}

const FOOT = `
  </main>
  <footer class="site-footer">
    <div class="wrap foot">
      <div>
        <strong>${BLOG} · by Brightfront Studio</strong>
        <p class="fine">${BLOG_TAG}. Plain-English guides, no jargon, no hype.</p>
        <nav aria-label="Footer">
          <a href="/blog/">Blog</a><a href="/blog/about/">About &amp; editorial policy</a><a href="/blog/feed.xml">RSS</a><a href="/">Brightfront Studio</a><a href="/resources/">Website guides</a><a href="/#contact">Contact</a><a href="/privacy/">Privacy</a>
        </nav>
      </div>
      <div>
        <p class="eyebrow">Email</p>
        <a href="mailto:info@brightfrontdesign.com">info@brightfrontdesign.com</a>
        <p class="fine" style="margin-top:.75rem">The articles on this blog are general information, not legal, tax or financial advice. Rules differ by country and state; check with a qualified professional for your situation.</p>
      </div>
    </div>
  </footer>
</body>
</html>
`;

const ORG = { "@type": "Organization", name: "Brightfront Studio", url: SITE + "/", logo: { "@type": "ImageObject", url: SITE + "/img/logo.png" } };

// ---------- load posts ----------
const posts = readdirSync(SRC).filter((f) => f.endsWith(".html")).map((f) => {
  const raw = readFileSync(join(SRC, f), "utf8");
  const m = raw.match(/^<!--([\s\S]*?)-->\s*([\s\S]*)$/);
  if (!m) throw new Error(`${f}: missing front matter`);
  const meta = JSON.parse(m[1]);
  meta.slug = f.replace(/\.html$/, "");
  meta.url = `${SITE}/blog/${meta.slug}/`;
  meta.updated ||= meta.date;
  const used = new Set();
  const toc = [];
  meta.body = m[2].replace(/<h2>([\s\S]*?)<\/h2>/g, (_, t) => {
    let id = slugify(t), n = 2;
    while (used.has(id)) id = `${slugify(t)}-${n++}`;
    used.add(id);
    toc.push({ id, t: strip(t) });
    return `<h2 id="${id}">${t}</h2>`;
  });
  if (meta.faq?.length) toc.push({ id: "faq", t: "Common questions" });
  meta.toc = toc;
  const words = strip(meta.body + (meta.faq || []).map((q) => q.q + " " + q.a).join(" ")).split(/\s+/).filter(Boolean).length;
  meta.words = words;
  meta.minutes = Math.max(1, Math.round(words / 230));
  return meta;
}).sort((a, b) => b.date.localeCompare(a.date) || (a.order ?? 99) - (b.order ?? 99));

const bySlug = Object.fromEntries(posts.map((p) => [p.slug, p]));
// Topic clusters for the /blog/ index. Each post names its cluster in front matter ("cluster");
// a post without one is listed under the fallback so it is never dropped from the index.
const CLUSTERS = ["Starting out", "Money, costs and pricing", "Getting customers and going online", "Skills, tools and staying safe"];
const FALLBACK_CLUSTER = "More guides";
for (const p of posts) {
  if (p.cluster && !CLUSTERS.includes(p.cluster)) throw new Error(`${p.slug}: unknown cluster "${p.cluster}"`);
  p.cluster ||= FALLBACK_CLUSTER;
}
const clusters = [...CLUSTERS, FALLBACK_CLUSTER].filter((c) => posts.some((p) => p.cluster === c));

// Real photos for posts: /img/blog/<slug>-{800,1200}w.webp (16:9 crops of the Pexels originals in img/blog/*.jpg).
const imgInfo = (image) => image.startsWith("/img/blog/")
  ? { w: 1200, h: 675, set: `${image}-800w.webp 800w, ${image}-1200w.webp 1200w`, src: `${image}-1200w.webp` }
  : IMAGES[image];

function picture(image, alt, eager) {
  const i = imgInfo(image);
  if (!i) throw new Error("Unknown image " + image);
  return `<img src="${i.src}" srcset="${i.set}" sizes="(min-width:1000px) 44rem, 100vw" width="${i.w}" height="${i.h}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"'}>`;
}

// ---------- post pages ----------
for (const p of posts) {
  for (const r of p.related || []) if (!bySlug[r]) throw new Error(`${p.slug}: unknown related ${r}`);
  const related = (p.related?.length ? p.related.map((r) => bySlug[r]) : posts.filter((x) => x !== p).slice(0, 3));
  const schema = [
    {
      "@context": "https://schema.org", "@type": "BlogPosting", headline: p.h1, description: p.description,
      datePublished: p.date, dateModified: p.updated, inLanguage: "en", wordCount: p.words,
      mainEntityOfPage: p.url, ...(p.image ? { image: SITE + imgInfo(p.image).src } : {}), articleSection: p.category,
      author: ORG, publisher: ORG, isPartOf: { "@type": "Blog", name: BLOG, url: SITE + "/blog/" },
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
        { "@type": "ListItem", position: 2, name: "Blog", item: SITE + "/blog/" },
        { "@type": "ListItem", position: 3, name: p.h1, item: p.url },
      ],
    },
  ];
  if (p.faq?.length) schema.push({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: p.faq.map((q) => ({ "@type": "Question", name: q.q, acceptedAnswer: { "@type": "Answer", text: strip(q.a) } })),
  });

  const html = head({ title: p.title, description: p.description, url: p.url, type: "article", image: p.image, imageAlt: p.imageAlt, schema, noImage: !p.image }) + `
    <div class="page-head">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/blog/">Blog</a> / <span>${esc(p.category)}</span></nav>
        <p class="eyebrow">${esc(p.category)}</p>
        <h1>${esc(p.h1)}</h1>
        <p class="lede">${p.lede}</p>
        <p class="byline"><span>By the Brightfront Studio team</span><span>Published <time datetime="${p.date}">${fmtDate(p.date)}</time></span>${p.updated !== p.date ? `<span>Updated <time datetime="${p.updated}">${fmtDate(p.updated)}</time></span>` : ""}<span>${p.minutes} min read</span></p>
      </div>
    </div>
    <div class="wrap layout">
      <nav class="toc" aria-label="On this page"><p>On this page</p><ol>${p.toc.map((t) => `<li><a href="#${t.id}">${esc(t.t)}</a></li>`).join("")}</ol></nav>
      <article class="article">
${p.image ? `<figure class="post-hero">${picture(p.image, p.imageAlt, true)}</figure>` : ""}
<div class="takeaways"><h2 class="tk">In short</h2><ul>
${p.takeaways.map((t) => `  <li>${t}</li>`).join("\n")}
</ul></div>
${p.body.trim()}
${p.faq?.length ? `<h2 id="faq">Common questions</h2>
<div class="faq">
${p.faq.map((q) => `<details><summary>${esc(q.q)}</summary><p>${q.a}</p></details>`).join("\n")}
</div>` : ""}
<aside class="author-box" aria-labelledby="author-h">
  <h2 id="author-h">Written and edited by the Brightfront Studio team</h2>
  <p>Brightfront Studio builds and looks after websites for small independent businesses: cafes, salons, food trucks, makers and consultants. We write ${BLOG} from the questions owners ask us when they start a business after 40, and every article is edited by a person before it is published.</p>
  <p><a href="/blog/about/">Read our editorial policy</a></p>
</aside>
<section class="cta" aria-labelledby="cta-h">
  <h2 id="cta-h">${esc(p.ctaTitle || "Need a simple website for your new business?")}</h2>
  <p>${p.ctaText || "Brightfront Studio builds and looks after websites for small businesses, so you don't have to learn the tech. $250 to start, $250 after you approve the finished site, then $49/month for hosting, updates and changes."}</p>
  <div class="actions"><a class="btn" href="/#contact">Get my website</a><a class="btn-ghost" href="/blog/">More articles</a></div>
</section>
<section class="related" aria-labelledby="rel-h">
  <h2 id="rel-h">Keep reading</h2>
  <ul>${related.map((r) => `<li><a href="/blog/${r.slug}/">${esc(r.h1)}</a></li>`).join("")}</ul>
</section>
      </article>
    </div>` + FOOT;
  mkdirSync(join(OUT, p.slug), { recursive: true });
  writeFileSync(join(OUT, p.slug, "index.html"), html);
}

// ---------- index ----------
const card = (p, tag = "h3") => `<li>${p.image ? `<a href="/blog/${p.slug}/" tabindex="-1" aria-hidden="true">${picture(p.image, "", false)}</a>` : ""}<div class="pl-body"><p class="cat">${esc(p.category)}</p><${tag}><a href="/blog/${p.slug}/">${esc(p.h1)}</a></${tag}><p>${esc(p.description)}</p><p class="pl-meta">${p.minutes} min read</p></div></li>`;
const feat = posts.find((p) => p.featured) || posts[0];
const indexSchema = [
  { "@context": "https://schema.org", "@type": "Blog", name: BLOG, description: BLOG_TAG, url: SITE + "/blog/", inLanguage: "en", publisher: ORG,
    blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.h1, url: p.url, datePublished: p.date })) },
  { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE + "/" },
    { "@type": "ListItem", position: 2, name: "Blog", item: SITE + "/blog/" }] },
];
const indexHtml = head({
  title: `${BLOG}: Starting a Small Business After 40 | Brightfront Studio`,
  description: "Plain-English guides for people 40 and over starting a side business, consulting practice or small shop: ideas, first steps, costs, pricing, customers and tech.",
  url: SITE + "/blog/", image: "/img/blog/how-to-start-a-business-after-40", imageAlt: "A woman in her fifties working on a laptop at a wooden desk in her office.", schema: indexSchema,
}) + `
    <div class="page-head">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/blog/">Blog</a></nav>
        <p class="eyebrow">The ${BLOG} blog</p>
        <h1>Starting a small business after 40, explained without the jargon</h1>
        <p class="lede">You have decades of skills, contacts and common sense. These guides show you how to turn them into a side business, a consulting practice or a small shop, one calm step at a time.</p>
        <ul class="cat-nav" aria-label="Topics">${clusters.map((c) => `<li><a href="#${slugify(c)}">${esc(c)}</a></li>`).join("")}</ul>
      </div>
    </div>
    <div class="wrap">
      <h2 class="sr-only">Latest article</h2>
      <article class="featured"><a href="/blog/${feat.slug}/" tabindex="-1" aria-hidden="true">${picture(feat.image, "", true)}</a><div class="pl-body"><p class="cat">Start here · ${esc(feat.cluster)}</p><h2><a href="/blog/${feat.slug}/">${esc(feat.h1)}</a></h2><p>${esc(feat.description)}</p><p class="pl-meta">${feat.minutes} min read</p></div></article>
${clusters.map((c) => {
  const list = posts.filter((p) => p.cluster === c && p !== feat);
  if (!list.length) return "";
  return `      <section aria-labelledby="${slugify(c)}"><h2 id="${slugify(c)}">${esc(c)}</h2><ul class="post-list">${list.map((p) => card(p)).join("")}</ul></section>`;
}).join("\n")}
      <section class="about-box" aria-labelledby="ab-h">
        <h2 id="ab-h">About this blog</h2>
        <p>${BLOG} is written by Brightfront Studio, a small studio that builds websites for independent shops and new businesses. Many of the people we work with started their business in their 40s, 50s or 60s. We write down what we see work for them, in plain English. <a href="/blog/about/">Read how we write and check our articles</a>.</p>
      </section>
    </div>` + FOOT;
writeFileSync(join(OUT, "index.html"), indexHtml);

// ---------- about / editorial policy ----------
const aboutUrl = SITE + "/blog/about/";
const aboutHtml = head({
  title: `About ${BLOG} and our editorial policy | Brightfront Studio`,
  description: `Who writes the ${BLOG} blog, who it is for, how we research and check every article, and how the site is funded.`,
  url: aboutUrl, schema: [{ "@context": "https://schema.org", "@type": "AboutPage", name: `About ${BLOG}`, url: aboutUrl, publisher: ORG }],
}) + `
    <div class="page-head">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/blog/">Blog</a> / <a href="/blog/about/">About</a></nav>
        <p class="eyebrow">About</p>
        <h1>About ${BLOG}</h1>
        <p class="lede">A blog for people 40 and over who want to build something of their own: a side income, a consulting practice, a small shop or a business they can run on their own terms.</p>
      </div>
    </div>
    <div class="wrap read article">
<h2>Who writes it</h2>
<p>${BLOG} is written and edited by the team at <a href="/">Brightfront Studio</a>. We build and maintain websites for small, independent businesses: cafes, salons, food trucks, makers, consultants and local services. Every week we talk to owners who are just getting started, and a large share of them are starting later in life, after a first career, after raising a family, or alongside a job they intend to keep for a while.</p>
<p>We are not lawyers, accountants or financial advisers, and we never pretend to be. When an article touches on registering a business, taxes or insurance, we explain the general idea and tell you who to ask for advice about your own situation.</p>
<h2>Who it is for</h2>
<p>Readers in their 40s, 50s, 60s and beyond who have real experience but may not feel at home with online marketing, websites or new tools. We assume you are smart and busy, not that you are "bad with technology". We explain every term the first time we use it.</p>
<h2>How we write and check articles</h2>
<ul>
  <li><strong>Practical first.</strong> Each article tries to answer one real question completely, with steps you can follow today.</li>
  <li><strong>No invented numbers.</strong> We avoid statistics we cannot stand behind. Where prices are mentioned, they are typical ranges and we say so.</li>
  <li><strong>Plain English.</strong> Short sentences, defined terms, no hype and no "get rich quick" promises. Most small businesses grow slowly, and we say that too.</li>
  <li><strong>Reviewed and updated.</strong> Articles carry a published date and, when we revise them, an updated date. If you spot a mistake, email <a href="mailto:info@brightfrontdesign.com">info@brightfrontdesign.com</a> and we will fix it.</li>
  <li><strong>Human-edited.</strong> We use writing tools to help with drafts, the same way we suggest you might in your own business, but every article is edited, fact-checked and approved by a person before it goes live.</li>
</ul>
<h2>Photos</h2>
<p>Photos: <a href="https://www.pexels.com/">Pexels</a>. The photos on this blog are real photographs from Pexels, used under the free Pexels licence. The people shown are not the people described in the articles.</p>
<ul>${posts.filter((p) => p.photoCredit).map((p) => `<li><a href="${p.photoCredit}" rel="nofollow noopener">Photo for &ldquo;${esc(p.h1)}&rdquo;</a></li>`).join("")}</ul>
<h2>How the blog is funded</h2>
<p>The blog is free to read. It is supported in two ways: by Brightfront Studio's website service, which we mention where it is genuinely relevant, and by advertising served by Google AdSense. Ads are clearly separate from our writing, and advertisers have no say in what we write. You can read how ads and cookies work on this site in our <a href="/privacy/">privacy policy</a>.</p>
<h2>Contact</h2>
<p>Questions, corrections or ideas for an article: <a href="mailto:info@brightfrontdesign.com">info@brightfrontdesign.com</a>.</p>
<section class="related" aria-labelledby="rel-h"><h2 id="rel-h">Good places to start</h2><ul>${posts.slice(0, 4).map((r) => `<li><a href="/blog/${r.slug}/">${esc(r.h1)}</a></li>`).join("")}</ul></section>
    </div>` + FOOT;
mkdirSync(join(OUT, "about"), { recursive: true });
writeFileSync(join(OUT, "about", "index.html"), aboutHtml);

// ---------- internal link check ----------
const known = new Set(["/", "/blog/", "/blog/about/", "/blog/feed.xml", ...posts.map((p) => `/blog/${p.slug}/`)]);
const fsExists = (u) => { try { readFileSync(join(root, u.replace(/^\//, ""), u.endsWith("/") ? "index.html" : "")); return true; } catch { return false; } };
for (const f of [...posts.map((p) => join(OUT, p.slug, "index.html")), join(OUT, "index.html"), join(OUT, "about", "index.html")]) {
  for (const [, href] of readFileSync(f, "utf8").matchAll(/href="(\/[^"#?]*)/g)) {
    if (href.startsWith("/assets/") || known.has(href)) continue;
    if (!fsExists(href)) throw new Error(`Broken internal link ${href} in ${f}`);
  }
}

// ---------- RSS ----------
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${BLOG} by Brightfront Studio</title>
  <link>${SITE}/blog/</link>
  <atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <description>${BLOG_TAG}</description>
  <language>en</language>
${posts.map((p) => `  <item><title>${esc(p.h1)}</title><link>${p.url}</link><guid>${p.url}</guid><pubDate>${new Date(p.date + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join("\n")}
</channel>
</rss>
`;
writeFileSync(join(OUT, "feed.xml"), rss);

// ---------- llms.txt (site root; https://llmstxt.org format) ----------
const llms = `# Brightfront Studio

> Brightfront Studio builds and looks after websites for small independent businesses. Its English blog, ${BLOG}, publishes plain-English guides for people 40 and over who are starting a side business, consulting practice or small shop.

The blog is written and edited by the Brightfront Studio team. Articles are general information, not legal, tax or financial advice.

## ${BLOG} blog

- [${BLOG} blog index](${SITE}/blog/): All articles, grouped by topic
${clusters.map((c) => posts.filter((p) => p.cluster === c).map((p) => `- [${p.h1}](${p.url}): ${p.description}`).join("\n")).join("\n")}

## About

- [About ${BLOG} and our editorial policy](${aboutUrl}): Who writes the blog, how articles are checked, and how it is funded
- [Brightfront Studio](${SITE}/): Websites for small businesses
`;
writeFileSync(join(root, "llms.txt"), llms);

// ---------- sitemap ----------
const smPath = join(root, "sitemap.xml");
let sm = readFileSync(smPath, "utf8");
const newest = posts.reduce((m, p) => (p.updated > m ? p.updated : m), "0000");
const entry = (loc, lastmod, freq, pri) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;
const block = `  <!-- blog:start (generated by scripts/build-blog.mjs) -->\n${[
  entry(SITE + "/blog/", newest, "weekly", "0.8"),
  entry(aboutUrl, newest, "yearly", "0.4"),
  ...posts.map((p) => entry(p.url, p.updated, "monthly", "0.7")),
].join("\n")}\n  <!-- blog:end -->`;
sm = sm.includes("<!-- blog:start") ? sm.replace(/  <!-- blog:start[\s\S]*?<!-- blog:end -->/, block) : sm.replace("</urlset>", block + "\n</urlset>");
writeFileSync(smPath, sm);

console.log(`Built ${posts.length} posts:`);
for (const p of posts) console.log(`  ${p.words.toString().padStart(5)} words  /blog/${p.slug}/`);
