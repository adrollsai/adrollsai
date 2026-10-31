# Everline Realty — high-converting real estate website template

A complete, dependency-free, multi-page real estate website. Plain HTML, one CSS file, one JS file — no build step, no framework, no npm install. Designed to be dropped into your Nobogent app and re-skinned by **replacing data, not markup**.

- **15 pages** — home, listings, property detail, agents, agent profile, sell/valuation landing page, services, about, insights index, article, contact, thank-you, 404, privacy, terms
- **Two files to edit per client**: `assets/js/config.js` (brand, contact, nav, footer) and `assets/js/data.js` (listings, agents, reviews, articles)
- Everything else — header, footer, menus, listing cards, property pages, agent pages, article pages — is generated from that data

---

## 1. Quick start

Open `index.html` in a browser. That's it.

To serve it locally (recommended, so `?id=` URLs and fonts behave exactly as in production):

```powershell
# any static server works
npx serve .
# or
python -m http.server 8080
```

### Page map

| File | Purpose | Data source |
|---|---|---|
| `index.html` | Home: hero + search, featured homes, proof, process, areas, reviews, valuation CTA, insights | `DATA` + `SITE` |
| `listings.html` | Search results: filter sidebar, sort, grid/list toggle, saved filter, map, empty state | `DATA.properties` |
| `property.html?id=p1` | Single listing: gallery + lightbox, facts, description, features, specs, map, mortgage calculator, viewing form, similar homes | `DATA.properties` |
| `agents.html` | Team directory + "who should I speak to" router + careers | `DATA.agents` |
| `agent.html?id=a1` | Agent profile: bio, stats, reviews, active listings, direct contact form | `DATA.agents` |
| `sell.html` | **Seller landing page**: dual-path hero form, what's included, 5-step process, net-proceeds calculator, seller reviews, FAQ | `DATA` + inline |
| `services.html` | Six services with named leads, detail sections, FAQ, callback form | `DATA.faqs` |
| `about.html` | Story, four rules, timeline, team preview, reviews slider | `DATA` |
| `blog.html` | Insights index: featured article, category filter, newsletter | `DATA.posts` |
| `blog-post.html?id=b1` | Article: prose blocks, author box, share row, inline enquiry form, related posts | `DATA.posts` |
| `contact.html` | Contact form, direct lines, opening hours, two offices, map, FAQ | `DATA.offices` |
| `thank-you.html` | Post-submit confirmation (personalised by `?form=`), next steps, featured homes | `DATA.properties` |
| `404.html` | Not found with recovery links and featured homes | `DATA.properties` |
| `privacy.html`, `terms.html` | Legal boilerplate — **replace with client's own text** | static |

---

## 2. Re-branding in one file

`assets/js/config.js` drives the whole chrome of the site. Change these values and every page updates:

| Key | What it controls |
|---|---|
| `brand.name`, `brand.suffix`, `brand.tagline` | Wordmark in header, drawer and footer |
| `brand.mark` | Logo mark path (`assets/img/logo-mark.svg`) |
| `brand.license` | Brokerage licence shown in the footer |
| `contact.phone` / `phoneDisplay` | Every `tel:` link (header, footer, forms, CTAs) |
| `contact.email`, `contact.sms`, `contact.whatsapp` | Email/text links |
| `contact.address` | Footer + contact page + schema |
| `contact.hours` | Contact page (used via `DATA.offices` too) |
| `contact.responsePromise` | The "we reply in 1 business hour" microcopy, reused site-wide |
| `market.city` / `region` / `metro` | Locality language in generated content |
| `rating` | Star rating shown in the top bar |
| `stats[]` | The animated stat band (`value`, `prefix`, `suffix`, `label`, `decimals`) |
| `nav[]` | Main navigation + mobile drawer |
| `cta` | The header button label and destination |
| `social[]` | Top-bar and footer social icons (`icon` must be a key in the `ICONS` sprite in `app.js`) |
| `footer.columns[]`, `footer.legal[]`, `footer.blurb`, `footer.disclaimer` | Footer |
| `forms.endpoint` | Where all forms POST (empty = demo mode) |
| `searchOptions` | Dropdown options on the home search bar |
| `features.*` | Toggle favourites, sticky mobile buy bar, floating CTA, back-to-top, stat counters |

**To change the colour scheme or fonts**, edit the tokens at the top of `assets/css/style.css`:
```css
:root{
  --brand: #0e5b4e;      /* primary buttons, links, accents */
  --accent: #c79a4b;     /* gold highlight, eyebrow rules, badges */
  --ink: #0b1220;        /* headings, dark bands */
  --bg: #faf8f4;         /* page background */
  --font-display: "Playfair Display", Georgia, serif;
  --font-body: "Inter", system-ui, sans-serif;
}
```

Nothing else needs to change — every component is built from these tokens.

### Contact details never need a second edit

Hard-coded phone numbers inside page copy are the classic templating bug. Two mechanisms prevent it:

- On boot, `normalizeContactLinks()` repoints **every** `tel:`, `mailto:` and `sms:` link in the document at `SITE.contact`, and rewrites the visible text when it is plainly a phone number or an email address. So `(555) 018-2245` in a page's CTA copy becomes the client's number automatically.
- Any element with a data hook gets its text replaced from config: `<span data-site="brand.license">CA DRE #02134567</span>`, `data-site="contact.email"`, `data-site="brand.tagline"`, and so on (dot-path into `SITE`).

Use `data-site` for anything else client-specific you add to page copy.

---

## 3. Replacing content

`assets/js/data.js` holds every repeatable record. It is a plain object, so a Nobogent app can emit it directly.

### Add a listing

```js
{
  id: "p13",                          // used in property.html?id=p13
  mls: "RV-2451600",
  title: "Sunlit Corner Townhouse",
  address: "12 Kestrel Lane", city: "Riverton", state: "CA", zip: "94107",
  price: 899000,
  status: "New",                      // For Sale | New | Open house | Pending | Sold
  type: "Townhouse",                  // House | Condo | Townhouse | Multi-family | Land
  beds: 3, baths: 2.5, sqft: 1680,
  lot: "0.07 acres", year: 2015, garage: 1, hoa: 285,
  days: 2,                            // days on market (drives "Newest" sort + labels)
  featured: true,                     // shows on the home page
  open: "Sunday 1:00pm – 3:00pm",     // optional open-house line
  neighbourhood: "The Old Quarter",   // must match a neighbourhood name for filters
  agentId: "a3",                      // must match an agent id
  images: ["assets/img/prop-04.svg", "assets/img/prop-09.svg", "assets/img/prop-02.svg", "assets/img/prop-07.svg"],
  summary: "One sentence used on the detail page lead.",
  description: ["Paragraph one.", "Paragraph two."],
  highlights: ["Built 2021", "Roof deck"],       // pills under the facts
  features: ["Roof deck", "EV charger"],         // "Features & finishes" list
  specs: { Parking: "1-car garage", Heating: "Heat pump", "Lot size": "0.07 acres" }
}
```

`land` records (type `"Land"`) can omit `beds`/`baths`/`sqft` — the card and detail page adapt automatically and the mortgage calculator hides itself.

### Add an agent

```js
{
  id: "a7", name: "Jordan Blake", role: "Sales Advisor",
  photo: "assets/img/agent-3.svg",
  phone: "(555) 018-2247", email: "jordan@everlinerealty.com",
  license: "CA DRE #02000000",
  rating: 4.9, reviews: 12, deals: 41, volume: "$38M", since: 2022,
  languages: ["English"],
  specialties: ["First-time buyers"],
  bio: ["Paragraph one.", "Paragraph two."],
  testimonial: { quote: "…", name: "Client Name", location: "Neighbourhood" }
}
```

### Add an article

Article bodies are simple blocks, so they survive any CMS or app export:

```js
body: [
  { type: "p",     text: "Intro paragraph." },
  { type: "h2",    text: "Section heading" },
  { type: "ul",    items: ["Point one", "Point two"] },
  { type: "quote", text: "Pull quote." },
  { type: "img",   src: "assets/img/post-3.svg", alt: "…" }
]
```

### Everything else

`DATA.testimonials`, `DATA.neighbourhoods`, `DATA.faqs` and `DATA.offices` are rendered into the review sliders, the "where we work" cards, the FAQ accordions and the contact page. Edit the arrays; no HTML changes needed.

---

## 4. Wiring the forms up

Every form on the site carries `data-form="…"` (`contact`, `valuation`, `viewing`, `newsletter`, `agent-contact`, …) and is handled by one function in `app.js`.

- **Demo mode (default):** `SITE.forms.endpoint` is empty. Forms validate, show a success message, log the payload to the console and forward to `thank-you.html?form=<name>`.
- **Live mode:** set an endpoint and every form POSTs JSON automatically:

```js
forms: {
  endpoint: "https://formspree.io/f/xxxxxxx",   // Formspree, Netlify, HubSpot, your API…
  method: "POST",
  redirect: "thank-you.html",
  demoRedirect: true    // false = stay on page after submit
}
```

Payload shape:

```json
{ "name": "…", "email": "…", "phone": "…", "message": "…",
  "form": "viewing", "page": "property.html", "property": "…", "submittedAt": "…" }
```

Built-in validation: required fields, email shape, phone shape, min length, checkbox consent, inline error text, `aria-invalid`, focus management and a live-region status message.

---

## 5. Conversion features already built in

Use this as a checklist when pitching — it is why the template outperforms a stock theme:

1. **Dual-path hero** — "Buy a home" / "Sell my home" tabs, so buyers and sellers both land in the right funnel.
2. **Search bar above the fold** on the home page, with quick-filter chips (new this week, open houses, waterfront, under $800k).
3. **Social proof everywhere** — top-bar rating, hero star rating, review sliders, per-agent ratings, seller-specific reviews on the sell page.
4. **Stat band** with animated counters (homes sold, volume, list-to-sale ratio).
5. **Featured listings** rendered from data, with status badges, monthly-payment estimate, agent attribution and save-to-favourites.
6. **Short, low-friction forms** (name + email + one context field) with a response-time promise under every one.
7. **Valuation offers on every page** — the strongest seller lead magnet — with a dedicated seller landing page.
8. **Mortgage calculator** on every property page and **net-proceeds calculator** for sellers.
9. **Sticky mobile buy bar** on property pages (price + call + book).
10. **Floating "Talk to an agent"** button and click-to-call in the header.
11. **Saved homes** persisted in `localStorage`, surfaced as a header badge and a "Saved only" filter.
12. **Honest-advice positioning** throughout (the "we'll tell you if now isn't the moment" section) — the differentiator most brokerages cannot copy, and the one that converts high-intent sellers.
13. **Thank-you page** that personalises itself by form type and keeps selling (next steps + featured homes).

---

## 6. Images

Shipped artwork is generated SVG so the site looks finished with **zero external requests**:

- `prop-01…12.svg` — listing photography (4:3)
- `hero-main.svg` (4:5), `hero-side.svg`, `about-story.svg` (7:5), `about-team.svg` (16:9)
- `agent-1…6.svg` — agent portraits (5:5.4)
- `post-1…6.svg`, `post-body.svg` — article imagery (16:9)
- `hood-1…4.svg` — neighbourhood cards (4:5)
- `testimonial-1…3.svg` — review avatars (1:1)
- `map-panel.svg` — map mock, `logo-mark.svg` / `favicon.svg` — brand mark, `og-cover.svg` — social card

**To use real photos**, drop files into `assets/img/` and change the paths in `data.js` (`images:`, `photo:`, `image:`) or directly in the page markup for non-data imagery. Recommended: `.webp`, 1600×1200 for cards, 2000×1500 for galleries, 1200×1500 for portraits, under 250 KB each.

To regenerate the placeholder art (e.g. to match a new palette):

```powershell
node tools/generate-placeholders.mjs   # palettes live at the top of the file
```

---

## 7. Before you launch (SEO & ops checklist)

Per client, in this order:

1. `config.js` → brand, phone, email, address, licence, stats, nav, footer blurb.
2. `data.js` → real listings, agents, reviews, articles, neighbourhoods, FAQs, offices.
3. Replace each page's `<title>`, `<meta name="description">`, `<link rel="canonical">` and the `og:` tags (and `og:image` with a **raster** image — 1200×630 JPG/PNG, not SVG, for social platforms).
4. Update the JSON-LD blocks in `index.html` (`RealEstateAgent`) and, if you use static property pages, `property.html` (injected automatically from data).
5. Remove `property.html`, `agent.html`, `blog-post.html` from search if you serve them dynamically behind a router — they ship with `noindex` for exactly that reason.
6. Swap `map-panel.svg` for a Google Maps / Mapbox iframe (a comment marks the spot on `listings.html` and `contact.html`).
7. Replace `privacy.html` and `terms.html` with the client's own reviewed copy, and delete the placeholder notices.
8. Add `sitemap.xml` + `robots.txt`, then submit to Search Console.
9. Add analytics (GA4 / Plausible / server-side) and **conversion events** on: form submit, phone click, valuation request, saved listing.
10. Replace the headless-generated SVG imagery with real photography — the single biggest quality jump available.

---

## 8. Accessibility & performance notes

- Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page, ordered headings.
- Skip link, visible focus rings, `aria-current` on the active nav item, `aria-pressed` on toggles, `aria-expanded` on the drawer and filter panel.
- Mobile drawer and lightbox trap intent: Escape closes, focus is restored to the trigger.
- Forms use real `<label>`s, `aria-invalid`, inline error text and a polite live region.
- FAQ accordions are native `<details>/<summary>` — they work without JavaScript.
- `prefers-reduced-motion` disables reveals, counters and slider autoplay.
- Images carry width/height (no layout shift) and `loading="lazy"` below the fold.
- No external JS. Only external dependency is Google Fonts (with `display=swap` and a system serif/sans fallback) — remove the two `<link>` tags for a fully offline site.

---

## 9. Dev tools included

```powershell
node tools/check.mjs                      # verifies every link, asset, id, data hook and JS file parses
node tools/generate-placeholders.mjs      # regenerates the SVG placeholder artwork
```

`tools/mobile-preview.html` renders any page inside a true 390 px viewport, which is the reliable way to check mobile layout in a desktop browser:

```
tools/mobile-preview.html?p=listings.html&h=2400
```

---

## 10. Plugging this into the Nobogent app

The template is deliberately data-shaped so your app only needs to emit two objects. The simplest integration:

```js
// emitted by your app before app.js loads
window.SITE = { brand: {...}, contact: {...}, nav: [...], footer: {...}, stats: [...] };
window.DATA = { properties: [...], agents: [...], testimonials: [...], posts: [...],
                neighbourhoods: [...], faqs: [...], offices: [...] };
```

Three practical options, cheapest first:

1. **String-replace** — treat `config.js` and `data.js` as templates with placeholder tokens (`{{brand_name}}`, `{{phone}}`), swap per client, deploy.
2. **Emit JSON** — have your app write `assets/js/config.js` / `data.js` as `window.SITE = {json};` / `window.DATA = {json};` from the client record. No HTML parsing, no diffing.
3. **Serve dynamically** — keep the HTML as a layout and inject `SITE`/`DATA` server-side or via an API call before `app.js` boots (move the two `<script>` tags to suit).

Field mapping you will need per client:

| Client record | Template destination |
|---|---|
| Business name, logo, tagline, licence | `SITE.brand.*` |
| Phone, email, address, hours | `SITE.contact.*`, `DATA.offices[]` |
| Social URLs | `SITE.social[]` |
| Guarantees / year founded / track record | `SITE.stats[]`, `SITE.rating`, page copy |
| Service areas | `DATA.neighbourhoods[]`, `listings.html` `<select>` options |
| Listings (id, price, beds, baths, sqft, address, photos, features) | `DATA.properties[]` |
| Team members | `DATA.agents[]` |
| Reviews | `DATA.testimonials[]` |
| Blog posts | `DATA.posts[]` |
| FAQs | `DATA.faqs[]` |
| CRM / form webhook | `SITE.forms.endpoint` |
| Brand colours, fonts | `:root` tokens in `assets/css/style.css` |

Because listing, agent and article pages read `?id=`, you can either ship the three detail templates and pass an id, or generate one static file per record (`property-sunlit-contemporary.html`) — both work with no code changes beyond the link.

---

## 11. File tree

```
.
├── index.html                 home
├── listings.html              search results
├── property.html              listing detail  (?id=p1)
├── agents.html                team directory
├── agent.html                 agent profile   (?id=a1)
├── sell.html                  seller landing page + valuation
├── services.html              service lines
├── about.html                 company
├── blog.html                  insights index
├── blog-post.html             article         (?id=b1)
├── contact.html               contact
├── thank-you.html             post-submit
├── 404.html
├── privacy.html
├── terms.html
├── assets
│   ├── css/style.css          design system + all components (single file)
│   ├── js/config.js           ⭐ brand, contact, nav, footer, forms, feature flags
│   ├── js/data.js             ⭐ listings, agents, reviews, posts, areas, FAQs, offices
│   ├── js/app.js              renderers, filters, calculators, forms, sliders, lightbox
│   └── img/*.svg              generated placeholder artwork (replace with photography)
├── tools
│   ├── check.mjs              link/asset/data integrity check
│   ├── generate-placeholders.mjs
│   └── mobile-preview.html    390px mobile preview harness
└── README.md
```

> The demo brand ("Everline Realty", Riverton CA), all listings, agents, reviews and articles are fictional placeholders — replace them before launch.
