/* ==========================================================================
   EVERLINE REALTY — APP
   --------------------------------------------------------------------------
   Vanilla JS, no dependencies, no build step.

   1.  Utilities                   8.  Property detail page
   2.  Icon sprite                 9.  Agent profile page
   3.  Header / nav / drawer      10.  Article page
   4.  Footer                     11.  Testimonial slider
   5.  Reveal + counters          12.  Mortgage calculator
   6.  Forms                      13.  Lightbox, favourites, floaters
   7.  Listings search engine     14.  Boot
   ========================================================================== */

(function () {
  "use strict";

  const SITE = window.SITE || {};
  const DATA = window.DATA || { properties: [], agents: [], testimonials: [], posts: [], neighbourhoods: [], faqs: [], offices: [] };

  /* ======================================================================
     1. Utilities
     ====================================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (str) =>
    String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n || n === 0 ? "$" + Number(n).toLocaleString("en-US") : "—");
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const shortMoney = (n) => (n >= 1e6 ? "$" + (n / 1e6).toFixed(n % 1e6 ? 2 : 0).replace(/\.0+$/, "") + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + n);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const params = () => new URLSearchParams(window.location.search);
  const debounce = (fn, wait = 180) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  };
  const currentPage = () => (window.location.pathname.split("/").pop() || "index.html").toLowerCase();
  const store = {
    get() {
      try { return JSON.parse(localStorage.getItem("everline:saved") || "[]"); } catch (e) { return []; }
    },
    set(list) {
      try { localStorage.setItem("everline:saved", JSON.stringify(list)); } catch (e) { /* private mode */ }
    },
  };
  const agentById = (id) => DATA.agents.find((a) => a.id === id);
  const propById = (id) => DATA.properties.find((p) => p.id === id);
  const postById = (id) => DATA.posts.find((b) => b.id === id);
  const fmtDate = (iso) =>
    new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  /** Monthly principal + interest payment. */
  function monthlyPayment(principal, ratePct, years) {
    const r = ratePct / 100 / 12;
    const n = years * 12;
    if (!r) return principal / n;
    return (principal * r) / (1 - Math.pow(1 + r, -n));
  }
  const estMonthly = (price) => monthlyPayment(price * 0.8, 6.5, 30);

  /* ======================================================================
     2. Icon sprite — 24×24, stroke = currentColor
     ====================================================================== */
  const ICONS = {
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    bed: '<path d="M2 5v15"/><path d="M2 12h20v8"/><path d="M22 20v-8a3 3 0 0 0-3-3h-8v3"/><circle cx="6.5" cy="9" r="2"/>',
    bath: '<path d="M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M6.5 12V6.2A2.2 2.2 0 0 1 8.7 4a2.2 2.2 0 0 1 2.2 2.2"/><path d="M4.5 20 3 22"/><path d="M19.5 20 21 22"/>',
    area: '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/>',
    lot: '<path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M9 20v-5h6v5"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.8 1.1-1.1a5.5 5.5 0 0 0-.1-7.7z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    arrowRight: '<path d="M4 12h15"/><path d="m13 5 7 7-7 7"/>',
    arrowLeft: '<path d="M20 12H5"/><path d="m11 19-7-7 7-7"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    star: '<path d="m12 2.6 2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.2-5.9 3.2 1.2-6.5L2.5 9.5l6.6-.9z"/>',
    menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4V9h4v1.5A6 6 0 0 1 16 8z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
    youtube: '<path d="M22.5 6.4a2.8 2.8 0 0 0-1.9-2C18.9 4 12 4 12 4s-6.9 0-8.6.4a2.8 2.8 0 0 0-1.9 2A29 29 0 0 0 1 11.8a29 29 0 0 0 .5 5.3 2.8 2.8 0 0 0 1.9 2C5.1 19.5 12 19.5 12 19.5s6.9 0 8.6-.4a2.8 2.8 0 0 0 1.9-2 29 29 0 0 0 .5-5.3 29 29 0 0 0-.5-5.4z"/><path d="m9.8 15 5.7-3.2-5.7-3.2z"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 11h18"/>',
    home: '<path d="M3 9.7 12 3l9 6.7V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 9.2-9.2"/><path d="m16 4 4 4"/>',
    trend: '<path d="M22 6 13.5 14.5 8.5 9.5 2 16"/><path d="M16 6h6v6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    sparkle: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 18l1.5-.5z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    rows: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="15" width="18" height="5" rx="1.5"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/>',
    filter: '<path d="M3 5h18l-7 8.5V21l-4-2.5v-5z"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/>',
    car: '<path d="M5 17h14"/><path d="M4 17V11l2-5h12l2 5v6"/><path d="M3 17v2h3v-2"/><path d="M18 17v2h3v-2"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/>',
    doc: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6M9 17h4"/>',
    award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
    handshake: '<path d="m11 17-4-4 4-4 3 3 3-3 4 4-4 4"/><path d="M3 12h2l2 2"/><path d="M19 12h2l-2 2"/>',
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  };

  function icon(name, cls) {
    const body = ICONS[name] || "";
    const filled = name === "star";
    return `<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ""}>${body}</svg>`;
  }
  const stars = (score = 5) =>
    `<span class="stars" role="img" aria-label="${score} out of 5">${Array.from({ length: 5 }, () => icon("star")).join("")}</span>`;

  /* ======================================================================
     3. Header, navigation, drawer
     ====================================================================== */
  const PAGE_ALIAS = {
    "property.html": "listings.html",
    "agent.html": "agents.html",
    "blog-post.html": "blog.html",
    "thank-you.html": "contact.html",
  };
  function isActive(href) {
    const page = currentPage();
    const target = (PAGE_ALIAS[page] || page).toLowerCase();
    return href.split("?")[0].toLowerCase() === target;
  }

  function headerHTML() {
    const c = SITE.contact;
    const socials = (SITE.social || [])
      .map((s) => `<a href="${s.href}" target="_blank" rel="noopener" aria-label="${esc(s.label)}">${icon(s.icon)}</a>`)
      .join("");
    const navLinks = (SITE.nav || [])
      .map((n) => `<a class="nav__link" href="${n.href}"${isActive(n.href) ? ' aria-current="page"' : ""}>${esc(n.label)}</a>`)
      .join("");
    const drawerLinks = (SITE.nav || [])
      .map((n) => `<a href="${n.href}"${isActive(n.href) ? ' aria-current="page"' : ""}>${esc(n.label)}${icon("chevronRight")}</a>`)
      .join("");
    const brandHref = "index.html";

    return `
    <div class="topbar">
      <div class="container topbar__inner">
        <ul class="topbar__list">
          <li class="topbar__item">${icon("phone")}<a href="tel:${esc(c.phone)}">${esc(c.phoneDisplay)}</a></li>
          <li class="topbar__item topbar__list--hide-sm">${icon("mail")}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>
          <li class="topbar__item topbar__list--hide-sm">${icon("star")}<span>${SITE.rating.score}/5 from ${SITE.rating.count} ${esc(SITE.rating.source)} reviews</span></li>
        </ul>
        <div class="topbar__socials">${socials}</div>
      </div>
    </div>

    <header class="site-header" id="siteHeaderSticky">
      <div class="container header__inner">
        <a class="brand" href="${brandHref}" aria-label="${esc(SITE.brand.name)} ${esc(SITE.brand.suffix)} — home">
          <img class="brand__mark" src="${SITE.brand.mark}" alt="" width="40" height="40">
          <span class="brand__text">
            <span class="brand__name">${esc(SITE.brand.name)}${SITE.brand.suffix ? " " + esc(SITE.brand.suffix) : ""}</span>
            <span class="brand__tag">${esc(SITE.brand.tagline)}</span>
          </span>
        </a>

        <nav class="nav" aria-label="Primary">${navLinks}</nav>

        <div class="header__actions">
          <a class="header__phone" href="tel:${esc(c.phone)}">
            ${icon("phone")}
            <span>${esc(c.phoneDisplay)}<small>Talk to an agent</small></span>
          </a>
          <a class="header__saved" href="listings.html#saved" aria-label="Saved homes">
            ${icon("heart")}<span class="header__saved-count" data-saved-count>0</span>
          </a>
          <a class="btn btn--primary" href="${SITE.cta.href}">${esc(SITE.cta.label)}</a>
          <button class="nav-toggle" type="button" data-drawer-open aria-label="Open menu" aria-expanded="false">${icon("menu")}</button>
        </div>
      </div>
    </header>

    <div class="drawer" id="drawer" aria-hidden="true">
      <button class="drawer__scrim" type="button" data-drawer-close tabindex="-1" aria-label="Close menu"></button>
      <div class="drawer__panel" role="dialog" aria-modal="true" aria-label="Site menu">
        <div class="drawer__head">
          <a class="brand" href="${brandHref}">
            <img class="brand__mark" src="${SITE.brand.mark}" alt="" width="40" height="40">
            <span class="brand__text"><span class="brand__name">${esc(SITE.brand.name)}</span></span>
          </a>
          <button class="drawer__close" type="button" data-drawer-close aria-label="Close menu">${icon("close")}</button>
        </div>
        <nav class="drawer__nav" aria-label="Mobile">${drawerLinks}</nav>
        <div class="drawer__foot">
          <a class="btn btn--primary btn--block" href="${SITE.cta.href}">${esc(SITE.cta.label)}</a>
          <p class="drawer__contact">${icon("phone")} <a href="tel:${esc(c.phone)}">${esc(c.phoneDisplay)}</a> · <a href="mailto:${esc(c.email)}">Email us</a></p>
        </div>
      </div>
    </div>`;
  }

  function mountHeader() {
    const host = document.getElementById("siteHeader");
    if (!host) return;
    host.insertAdjacentHTML("beforebegin", headerHTML());
    host.remove();

    const sticky = document.getElementById("siteHeaderSticky");
    const drawer = document.getElementById("drawer");
    const openBtn = $("[data-drawer-open]");
    const lastFocus = { el: null };

    const onScroll = () => {
      if (sticky) sticky.classList.toggle("is-stuck", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    function openDrawer() {
      lastFocus.el = document.activeElement;
      drawer.classList.add("is-open");
      drawer.setAttribute("aria-hidden", "false");
      openBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      const first = $(".drawer__close", drawer);
      if (first) first.focus();
    }
    function closeDrawer() {
      drawer.classList.remove("is-open");
      drawer.setAttribute("aria-hidden", "true");
      if (openBtn) openBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (lastFocus.el) lastFocus.el.focus();
    }
    if (openBtn) openBtn.addEventListener("click", openDrawer);
    $$("[data-drawer-close]").forEach((b) => b.addEventListener("click", closeDrawer));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer();
    });
    // close drawer when a link is followed (same-page anchors)
    $$(".drawer__nav a, .drawer__foot a").forEach((a) => a.addEventListener("click", () => {
      drawer.classList.remove("is-open");
      document.body.style.overflow = "";
    }));
  }

  /* ======================================================================
     4. Footer
     ====================================================================== */
  function footerHTML() {
    const c = SITE.contact;
    const f = SITE.footer;
    const socials = (SITE.social || [])
      .map((s) => `<a href="${s.href}" target="_blank" rel="noopener" aria-label="${esc(s.label)}">${icon(s.icon)}</a>`)
      .join("");
    const columns = f.columns
      .map((col) => `
        <div>
          <h3>${esc(col.title)}</h3>
          <ul class="footer__links">${col.links.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join("")}</ul>
        </div>`)
      .join("");
    return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer__grid">
          <div class="footer__brand">
            <a class="brand" href="index.html">
              <img class="brand__mark" src="${SITE.brand.mark}" alt="" width="40" height="40">
              <span class="brand__text">
                <span class="brand__name">${esc(SITE.brand.name)}${SITE.brand.suffix ? " " + esc(SITE.brand.suffix) : ""}</span>
                <span class="brand__tag">${esc(SITE.brand.tagline)}</span>
              </span>
            </a>
            <p>${esc(f.blurb)}</p>
            <ul class="footer__contact">
              <li>${icon("pin")}<span>${esc(c.address.line1)}<br>${esc(c.address.line2)}</span></li>
              <li>${icon("phone")}<a href="tel:${esc(c.phone)}">${esc(c.phoneDisplay)}</a></li>
              <li>${icon("mail")}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>
            </ul>
            <div class="footer__socials">${socials}</div>
          </div>
          ${columns}
          <div>
            <h3>Stay ahead of the market</h3>
            <div class="newsletter">
              <p>One short email a month: new listings before they hit the portals, plus the local numbers that matter.</p>
              <form class="newsletter__form" data-form="newsletter" novalidate>
                <label class="visually-hidden" for="newsletterEmail">Email address</label>
                <input id="newsletterEmail" type="email" name="email" placeholder="Your email address" required>
                <button class="btn btn--accent btn--sm" type="submit">Join</button>
              </form>
              <div class="form-status" data-form-status role="status" aria-live="polite"></div>
              <p class="tiny" style="color:#7f909f;margin-top:.35rem">${esc(c.responsePromise)}</p>
            </div>
          </div>
        </div>

        <div class="footer__bottom">
          <p style="margin:0">© <span data-year>${new Date().getFullYear()}</span> ${esc(SITE.brand.name)} ${esc(SITE.brand.suffix)}. All rights reserved. ${SITE.brand.license ? esc(SITE.brand.license) + "." : ""}</p>
          <ul class="footer__legal">${f.legal.map((l) => `<li><a href="${l.href}">${esc(l.label)}</a></li>`).join("")}</ul>
        </div>
        <p class="footer__disclaimer">${esc(f.disclaimer)} <span class="footer__equal">Equal Housing Opportunity</span></p>
      </div>
    </footer>`;
  }

  function mountFooter() {
    const host = document.getElementById("siteFooter");
    if (!host) return;
    host.insertAdjacentHTML("beforebegin", footerHTML());
    host.remove();
    $$("[data-year]").forEach((n) => (n.textContent = new Date().getFullYear()));
  }

  /* ======================================================================
     5. Reveal on scroll + animated counters
     ====================================================================== */
  function initReveal() {
    const items = $$("[data-reveal]");
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    items.forEach((el) => io.observe(el));
  }

  function initCounters() {
    if (!SITE.features || !SITE.features.counters) return;
    const nodes = $$("[data-count-to]");
    if (!nodes.length) return;
    const run = (el) => {
      const target = parseFloat(el.dataset.countTo);
      const decimals = parseInt(el.dataset.decimals || "0", 10);
      const prefix = el.dataset.prefix || "";
      const suffix = el.dataset.suffix || "";
      const dur = 1400;
      const start = performance.now();
      const step = (now) => {
        const t = clamp((now - start) / dur, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + (target * eased).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + suffix;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            run(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    nodes.forEach((n) => io.observe(n));
  }

  /* ======================================================================
     6. Forms
     ====================================================================== */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  const PHONE_RE = /^[+()\d\s.-]{7,}$/;

  function fieldWrap(input) {
    return input.closest(".field, .checkbox, .newsletter__form") || input.parentElement;
  }

  function validateField(input) {
    const wrap = fieldWrap(input);
    const value = (input.value || "").trim();
    let message = "";
    if (input.hasAttribute("required") && !value) {
      message = input.dataset.error || "This field is required.";
    } else if (value && input.type === "email" && !EMAIL_RE.test(value)) {
      message = "Please enter a valid email address.";
    } else if (value && input.type === "tel" && !PHONE_RE.test(value)) {
      message = "Please enter a valid phone number.";
    } else if (value && input.minLength > 0 && value.length < input.minLength) {
      message = `Please use at least ${input.minLength} characters.`;
    } else if (input.type === "checkbox" && input.hasAttribute("required") && !input.checked) {
      message = "Please confirm to continue.";
    }
    if (wrap) {
      wrap.classList.toggle("has-error", Boolean(message));
      let err = wrap.querySelector(".field__error");
      if (message && !err && wrap.classList.contains("field")) {
        err = document.createElement("span");
        err.className = "field__error";
        wrap.appendChild(err);
      }
      if (err) err.textContent = message;
    }
    input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }

  function setStatus(form, message, kind) {
    let box = form.querySelector("[data-form-status]");
    if (!box) {
      box = document.createElement("div");
      box.className = "form-status";
      box.setAttribute("data-form-status", "");
      box.setAttribute("role", "status");
      form.appendChild(box);
    }
    box.className = "form-status is-visible form-status--" + kind;
    box.textContent = message;
  }

  function initForms(root = document) {
    $$("form[data-form]", root).forEach((form) => {
      if (form.dataset.bound) return;
      form.dataset.bound = "1";
      const inputs = $$("input, select, textarea", form).filter((i) => i.type !== "hidden" && i.type !== "submit");

      inputs.forEach((input) => {
        input.addEventListener("blur", () => {
          if (input.value || input.hasAttribute("required")) validateField(input);
        });
        input.addEventListener("input", () => {
          const wrap = fieldWrap(input);
          if (wrap && wrap.classList.contains("has-error")) validateField(input);
        });
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const ok = inputs.map((i) => validateField(i)).every(Boolean);
        if (!ok) {
          const firstBad = $(".has-error input, .has-error select, .has-error textarea", form) || $("[aria-invalid='true']", form);
          if (firstBad) firstBad.focus();
          setStatus(form, "Please check the highlighted fields and try again.", "error");
          return;
        }

        const btn = form.querySelector("[type='submit']");
        const original = btn ? btn.innerHTML : "";
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = "Sending…";
        }

        const payload = Object.fromEntries(new FormData(form).entries());
        payload.form = form.dataset.form;
        payload.page = currentPage();
        payload.submittedAt = new Date().toISOString();

        const endpoint = SITE.forms && SITE.forms.endpoint;
        try {
          if (endpoint) {
            const res = await fetch(endpoint, {
              method: (SITE.forms && SITE.forms.method) || "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("Request failed: " + res.status);
          } else {
            // Demo mode — no backend wired up yet.
            console.info("[Everline template] Form captured (demo mode):", payload);
            await new Promise((r) => setTimeout(r, 550));
          }

          setStatus(form, "Thank you — your message is on its way. One of our advisors will be in touch shortly.", "ok");
          form.reset();
          $$(".field, .checkbox", form).forEach((f) => f.classList.remove("has-error"));

          const redirect = SITE.forms && SITE.forms.redirect;
          if (SITE.forms && SITE.forms.demoRedirect && redirect && form.dataset.form !== "newsletter") {
            setTimeout(() => {
              window.location.href = redirect + "?form=" + encodeURIComponent(payload.form || "enquiry");
            }, 700);
          }
        } catch (err) {
          console.error(err);
          setStatus(form, "Something went wrong sending your message. Please call us on " + (SITE.contact.phoneDisplay || "our office") + ".", "error");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
          }
        }
      });
    });
  }

  /* ======================================================================
     7. Listings search engine
     ====================================================================== */
  const SORT_FNS = {
    featured: (a, b) => Number(b.featured) - Number(a.featured) || a.days - b.days,
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    newest: (a, b) => a.days - b.days,
    "sqft-desc": (a, b) => b.sqft - a.sqft,
    "beds-desc": (a, b) => b.beds - a.beds,
  };

  function statusBadge(status) {
    const map = { New: "badge--new", Sold: "badge--sold", Pending: "badge--pending", "Open house": "badge--open" };
    if (!status || status === "For Sale") return "";
    return `<span class="badge ${map[status] || ""}">${esc(status)}</span>`;
  }

  function listingCard(p) {
    const agent = agentById(p.agentId);
    const saved = store.get().includes(p.id);
    const isLand = p.type === "Land";
    const meta = isLand
      ? `<span>${icon("lot")}${esc(p.lot)}</span><span>${icon("area")}Buildable</span><span>${icon("doc")}Plans approved</span>`
      : `<span>${icon("bed")}${p.beds} bd</span><span>${icon("bath")}${p.baths} ba</span><span>${icon("area")}${num(p.sqft)} sq ft</span>`;
    return `
    <article class="listing-card" data-listing-card>
      <a class="listing-card__media" href="property.html?id=${encodeURIComponent(p.id)}" aria-label="View ${esc(p.title)}">
        <img src="${esc(p.images[0])}" alt="${esc(p.address)}, ${esc(p.city)}" loading="lazy" width="800" height="600">
        <span class="listing-card__badges">
          ${statusBadge(p.status)}
          ${p.featured ? '<span class="badge">Featured</span>' : ""}
        </span>
      </a>
      <button class="save-btn js-save${saved ? " is-saved" : ""}" type="button" data-save="${esc(p.id)}"
              aria-pressed="${saved}" aria-label="Save ${esc(p.address)}">${icon("heart")}</button>
      <div class="listing-card__body">
        <p class="listing-card__price">${money(p.price)}${p.status === "Sold" ? "" : `<small>est. ${money(Math.round(estMonthly(p.price)))}/mo</small>`}</p>
        <h3 class="listing-card__title"><a href="property.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
        <p class="listing-card__addr">${icon("pin")}<span>${esc(p.address)}, ${esc(p.city)}, ${esc(p.state)}</span></p>
        <div class="listing-card__meta">${meta}</div>
        <div class="listing-card__foot">
          <span class="listing-card__agent"><img src="${esc(agent ? agent.photo : SITE.brand.mark)}" alt="" width="24" height="24">${esc(agent ? agent.name : SITE.brand.name)}</span>
          <span>${p.days === 0 ? "New today" : p.days === 1 ? "1 day on market" : p.days + " days on market"}</span>
        </div>
      </div>
    </article>`;
  }

  function initListings() {
    const root = document.getElementById("listingsApp");
    if (!root) return;
    const grid = $("[data-results-grid]", root);
    const countEl = $("[data-results-count]", root);
    const chipsEl = $("[data-active-filters]", root);
    const emptyEl = $("[data-empty]", root);
    const loadWrap = $("[data-load-more-wrap]", root);
    const loadBtn = $("[data-load-more]", root);
    const sortSel = $("[data-sort]", root);
    const form = $("[data-filter-form]", root);

    const url = params();
    const state = {
      q: url.get("q") || "",
      loc: url.get("loc") || "",
      type: url.get("type") || "",
      status: url.get("status") || (url.get("open") ? "Open house" : ""),
      beds: Number(url.get("beds") || 0),
      baths: Number(url.get("baths") || 0),
      min: Number(url.get("min") || 0),
      max: Number(url.get("max") || url.get("priceMax") || 0),
      sort: url.get("sort") || "featured",
      view: "grid",
      perPage: 6,
      shown: 6,
      savedOnly: false,
    };

    /* hydrate controls from URL */
    if (form) {
      const setVal = (name, value) => {
        const el = form.querySelector(`[name="${name}"]`);
        if (el && value !== "" && value != null) el.value = value;
      };
      setVal("q", state.q);
      setVal("loc", state.loc);
      setVal("type", state.type);
      setVal("status", state.status);
      if (state.min) setVal("min", state.min);
      if (state.max) setVal("max", state.max);
    }
    $$("[data-seg-group='beds'] [data-value]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value) === state.beds)));
    $$("[data-seg-group='baths'] [data-value]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value) === state.baths)));
    if (sortSel) sortSel.value = state.sort;

    function matches(p) {
      const q = state.q.trim().toLowerCase();
      const haystack = [p.title, p.address, p.city, p.neighbourhood, p.type, p.zip, p.mls].join(" ").toLowerCase();
      if (q && !haystack.includes(q)) return false;
      if (state.loc && p.neighbourhood !== state.loc && p.city !== state.loc) return false;
      if (state.type && p.type !== state.type) return false;
      if (state.status && p.status !== state.status) return false;
      if (state.beds && p.beds < state.beds) return false;
      if (state.baths && p.baths < state.baths) return false;
      if (state.min && p.price < state.min) return false;
      if (state.max && p.price > state.max) return false;
      if (state.savedOnly && !store.get().includes(p.id)) return false;
      return true;
    }

    function activeFilterList() {
      const list = [];
      if (state.q) list.push({ key: "q", label: `“${state.q}”` });
      if (state.loc) list.push({ key: "loc", label: state.loc });
      if (state.type) list.push({ key: "type", label: state.type });
      if (state.status) list.push({ key: "status", label: state.status });
      if (state.beds) list.push({ key: "beds", label: state.beds + "+ beds" });
      if (state.baths) list.push({ key: "baths", label: state.baths + "+ baths" });
      if (state.min) list.push({ key: "min", label: "From " + shortMoney(state.min) });
      if (state.max) list.push({ key: "max", label: "Up to " + shortMoney(state.max) });
      if (state.savedOnly) list.push({ key: "savedOnly", label: "Saved only" });
      return list;
    }

    function syncURL() {
      const qs = new URLSearchParams();
      ["q", "loc", "type", "status", "beds", "baths"].forEach((k) => state[k] && qs.set(k, state[k]));
      if (state.min) qs.set("min", state.min);
      if (state.max) qs.set("max", state.max);
      if (state.sort !== "featured") qs.set("sort", state.sort);
      const next = qs.toString();
      history.replaceState(null, "", next ? "?" + next : location.pathname);
    }

    function render() {
      const results = DATA.properties.filter(matches).sort(SORT_FNS[state.sort] || SORT_FNS.featured);
      const visible = results.slice(0, state.shown);

      grid.innerHTML = visible.map(listingCard).join("");
      grid.classList.toggle("grid--listing-rows", state.view === "list");
      $$("[data-listing-card]", grid).forEach((card) => {
        if (state.view === "list") card.classList.add("listing-card--row");
      });

      if (countEl) {
        countEl.innerHTML = results.length
          ? `Showing <strong>${visible.length}</strong> of <strong>${results.length}</strong> ${results.length === 1 ? "home" : "homes"}`
          : "No matching homes";
      }
      if (emptyEl) emptyEl.hidden = results.length !== 0;
      if (loadWrap) loadWrap.hidden = results.length <= state.shown;

      if (chipsEl) {
        const list = activeFilterList();
        chipsEl.innerHTML = list
          .map((f) => `<span class="active-filter">${esc(f.label)}<button type="button" data-clear="${f.key}" aria-label="Remove ${esc(f.label)} filter">${icon("close")}</button></span>`)
          .join("");
        chipsEl.hidden = list.length === 0;
      }
      if (sortSel) sortSel.value = state.sort;
      updateSavedCount();
      syncURL();
    }

    /* filter form */
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        state.q = String(fd.get("q") || "");
        state.loc = String(fd.get("loc") || "");
        state.type = String(fd.get("type") || "");
        state.status = String(fd.get("status") || "");
        state.min = Number(fd.get("min") || 0) || 0;
        state.max = Number(fd.get("max") || 0) || 0;
        state.shown = state.perPage;
        render();
        const anchor = $("#results");
        if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      form.addEventListener("reset", () => {
        setTimeout(() => {
          state.q = state.loc = state.type = state.status = "";
          state.min = state.max = 0;
          state.beds = state.baths = 0;
          state.savedOnly = false;
          $$("[data-seg] [data-value]").forEach((b) => b.setAttribute("aria-pressed", "false"));
          state.shown = state.perPage;
          render();
        }, 0);
      });
      const liveSearch = form.querySelector("[name='q']");
      if (liveSearch) {
        liveSearch.addEventListener(
          "input",
          debounce(() => {
            state.q = liveSearch.value;
            state.shown = state.perPage;
            render();
          }, 260)
        );
      }
    }

    /* segmented buttons (beds / baths) */
    $$("[data-seg]", root).forEach((group) => {
      group.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-value]");
        if (!btn) return;
        const key = group.dataset.seg;
        const val = Number(btn.dataset.value);
        const next = state[key] === val ? 0 : val;
        state[key] = next;
        $$("[data-value]", group).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value) === next)));
        state.shown = state.perPage;
        render();
      });
    });

    if (sortSel) {
      sortSel.addEventListener("change", () => {
        state.sort = sortSel.value;
        render();
      });
    }

    if (loadBtn) {
      loadBtn.addEventListener("click", () => {
        state.shown += state.perPage;
        render();
      });
    }

    if (chipsEl) {
      chipsEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-clear]");
        if (!btn) return;
        const key = btn.dataset.clear;
        state[key] = key === "savedOnly" ? false : key === "beds" || key === "baths" || key === "min" || key === "max" ? 0 : "";
        if (form) {
          const input = form.querySelector(`[name="${key}"]`);
          if (input) input.value = "";
        }
        if (key === "beds" || key === "baths") {
          $$(`[data-seg='${key}'] [data-value]`).forEach((b) => b.setAttribute("aria-pressed", "false"));
        }
        render();
      });
    }

    /* view toggle */
    $$("[data-view]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        state.view = btn.dataset.view;
        $$("[data-view]", root).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        render();
      });
    });

    /* saved-only toggle */
    const savedToggle = $("[data-saved-filter]", root);
    const syncSavedToggle = () => {
      if (!savedToggle) return;
      const n = store.get().length;
      savedToggle.textContent = `Saved (${n})`;
      savedToggle.disabled = n === 0 && !state.savedOnly;
      savedToggle.classList.toggle("is-active", state.savedOnly);
    };
    if (savedToggle) {
      savedToggle.addEventListener("click", () => {
        state.savedOnly = !state.savedOnly;
        state.shown = state.perPage;
        syncSavedToggle();
        render();
      });
      syncSavedToggle();
    }

    /* deep link to #saved */
    if (location.hash === "#saved" && store.get().length) {
      state.savedOnly = true;
      syncSavedToggle();
    }

    /* mobile filter panel */
    const filterToggle = $("[data-filters-toggle]", root);
    const filterPanel = $(".filters", root);
    if (filterToggle && filterPanel) {
      filterPanel.classList.add("is-collapsed");
      filterToggle.addEventListener("click", () => {
        const collapsed = filterPanel.classList.toggle("is-collapsed");
        filterToggle.setAttribute("aria-expanded", String(!collapsed));
        filterToggle.innerHTML = collapsed ? icon("filter") + " Show filters" : icon("close") + " Hide filters";
      });
    }

    render();
    window.__listingsRender = render;
    window.__listingsSyncSaved = syncSavedToggle;
  }

  /* helpers used by list pages / home */
  function renderFeatured(limit) {
    const host = $("[data-render='featured']");
    if (!host) return;
    const items = DATA.properties.filter((p) => p.featured).slice(0, limit || 6);
    host.innerHTML = items.map(listingCard).join("");
  }

  function renderNeighbourhoods() {
    $$("[data-render='neighbourhoods']").forEach((host) => {
      const limit = Number(host.dataset.limit || DATA.neighbourhoods.length);
      host.innerHTML = DATA.neighbourhoods
        .slice(0, limit)
        .map(
          (n) => `
        <a class="hood-card" href="${n.href}">
          <img src="${esc(n.image)}" alt="${esc(n.name)}" loading="lazy" width="600" height="750">
          <div class="hood-card__content">
            <h3>${esc(n.name)}</h3>
            <p>${esc(n.blurb)}</p>
            <span class="hood-card__count">${icon("home")}${n.count} homes · median ${esc(n.median)}</span>
          </div>
        </a>`
        )
        .join("");
    });
  }

  function agentCard(a) {
    return `
      <article class="agent-card">
        <a class="agent-card__media" href="agent.html?id=${encodeURIComponent(a.id)}" aria-label="View profile for ${esc(a.name)}">
          <img src="${esc(a.photo)}" alt="Portrait of ${esc(a.name)}" loading="lazy" width="500" height="540">
        </a>
        <div class="agent-card__body">
          <span class="agent-card__role">${esc(a.role)}</span>
          <h3 class="agent-card__name"><a href="agent.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}</a></h3>
          <p class="tiny muted" style="margin:0">${esc(a.specialties.slice(0, 2).join(" · "))}</p>
          <div class="agent-card__stats">
            <span><b>${a.deals}</b>deals</span>
            <span><b>${esc(a.volume)}</b>volume</span>
            <span><b>${a.rating.toFixed(1)}★</b>${a.reviews} reviews</span>
          </div>
          <div class="agent-card__contact">
            <a class="btn btn--ghost btn--sm" href="tel:${esc(a.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} Call</a>
            <a class="btn btn--primary btn--sm" href="agent.html?id=${encodeURIComponent(a.id)}">Profile</a>
          </div>
        </div>
      </article>`;
  }

  function renderAgents() {
    $$("[data-render='agents']").forEach((host) => {
      const limit = Number(host.dataset.limit || DATA.agents.length);
      host.innerHTML = DATA.agents.slice(0, limit).map(agentCard).join("");
    });
  }

  function postCard(p, featured) {
    const author = agentById(p.authorId);
    return `
      <article class="post-card${featured ? " post-card--featured" : ""}" data-category="${esc(p.category)}">
        <a class="post-card__media" href="blog-post.html?id=${encodeURIComponent(p.id)}" aria-label="Read ${esc(p.title)}">
          <img src="${esc(p.image)}" alt="" loading="lazy" width="800" height="500">
        </a>
        <div class="post-card__body">
          <div class="post-card__meta">
            <span>${esc(p.category)}</span><span class="dot"></span><span class="date">${fmtDate(p.date)} · ${p.readTime} min read</span>
          </div>
          <h3 class="post-card__title"><a href="blog-post.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></h3>
          <p class="post-card__excerpt">${esc(p.excerpt)}</p>
          <span class="tiny muted" style="display:flex;align-items:center;gap:.45rem">${author ? `<img src="${esc(author.photo)}" alt="" width="22" height="22" style="border-radius:50%"> ${esc(author.name)}` : ""}</span>
          <a class="link-arrow" href="blog-post.html?id=${encodeURIComponent(p.id)}">Read the article ${icon("arrowRight")}</a>
        </div>
      </article>`;
  }

  function renderPosts() {
    $$("[data-render='posts']").forEach((host) => {
      const limit = Number(host.dataset.limit || DATA.posts.length);
      const skip = Number(host.dataset.skip || 0);
      const featuredFirst = host.dataset.featured === "first";
      const list = DATA.posts.slice(skip, skip + limit);
      host.innerHTML = list.map((p, i) => postCard(p, featuredFirst && i === 0)).join("");
    });
  }

  function renderStats() {
    $$("[data-render='stats']").forEach((host) => {
      host.innerHTML = (SITE.stats || [])
        .map(
          (s, i) => `
        <div class="stat${i > 0 ? " stat--bordered" : ""}" data-reveal data-reveal-delay="${i}">
          <span class="stat__num" data-count-to="${s.value}" data-decimals="${s.decimals || 0}" data-prefix="${s.prefix || ""}" data-suffix="${s.suffix || ""}">${(s.prefix || "") + s.value + (s.suffix || "")}</span>
          <span class="stat__label">${esc(s.label)}</span>
        </div>`
        )
        .join("");
    });
  }

  function renderFaqs() {
    $$("[data-render='faqs']").forEach((host) => {
      const limit = Number(host.dataset.limit || DATA.faqs.length);
      host.innerHTML = DATA.faqs
        .slice(0, limit)
        .map(
          (f, i) => `
        <details${i === 0 ? " open" : ""}>
          <summary>${esc(f.q)}</summary>
          <div class="accordion__body">${esc(f.a)}</div>
        </details>`
        )
        .join("");
    });
  }

  function renderOffices() {
    $$("[data-render='offices']").forEach((host) => {
      host.innerHTML = DATA.offices
        .map(
          (o) => `
        <div class="card">
          <div class="card__body">
            <h3 style="font-size:1.1rem">${esc(o.name)}</h3>
            <ul class="footer__contact" style="color:var(--body)">
              <li>${icon("pin")}<span>${esc(o.address)}</span></li>
              <li>${icon("phone")}<a href="tel:${esc(o.phone.replace(/[^\d+]/g, ""))}">${esc(o.phone)}</a></li>
              <li>${icon("clock")}<span>${esc(o.hours)}</span></li>
            </ul>
          </div>
        </div>`
        )
        .join("");
    });
  }

  /* ======================================================================
     8. Property detail page
     ====================================================================== */
  function initProperty() {
    const root = document.getElementById("propertyApp");
    if (!root) return;

    const id = params().get("id");
    const p = propById(id) || DATA.properties.find((x) => x.featured) || DATA.properties[0];
    if (!p) return;
    const agent = agentById(p.agentId) || DATA.agents[0];
    const isLand = p.type === "Land";

    document.title = `${p.title} — ${p.address}, ${p.city} | ${SITE.brand.name} ${SITE.brand.suffix}`;
    document.body.classList.add("has-property-bar");

    const facts = [
      p.beds ? { icon: "bed", value: p.beds, label: "Bedrooms" } : null,
      p.baths ? { icon: "bath", value: p.baths, label: "Bathrooms" } : null,
      p.sqft ? { icon: "area", value: num(p.sqft), label: "Square feet" } : null,
      p.lot && p.lot !== "—" ? { icon: "lot", value: p.lot, label: isLand ? "Land" : "Lot size" } : null,
      p.year ? { icon: "calendar", value: p.year, label: "Year built" } : null,
      p.garage ? { icon: "car", value: p.garage, label: "Car parking" } : null,
    ].filter(Boolean);

    const gallery = `
      <div class="gallery" data-gallery>
        <button class="gallery__item gallery__item--main" type="button" data-lightbox-index="0" aria-label="Open photo 1 of ${p.images.length}">
          <img src="${esc(p.images[0])}" alt="${esc(p.address)} — main photo" width="1200" height="900">
          <span class="gallery__all">${icon("camera")} View all ${p.images.length} photos</span>
        </button>
        ${p.images
          .slice(1, 3)
          .map(
            (src, i) => `
          <button class="gallery__item" type="button" data-lightbox-index="${i + 1}" aria-label="Open photo ${i + 2} of ${p.images.length}">
            <img src="${esc(src)}" alt="${esc(p.address)} — photo ${i + 2}" loading="lazy" width="800" height="450">
          </button>`
          )
          .join("")}
      </div>`;

    const similar = DATA.properties
      .filter((x) => x.id !== p.id && (x.neighbourhood === p.neighbourhood || Math.abs(x.price - p.price) / p.price < 0.45))
      .slice(0, 3);

    root.innerHTML = `
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="index.html">Home</a>${icon("chevronRight")}
          <a href="listings.html">Listings</a>${icon("chevronRight")}
          <a href="listings.html?loc=${encodeURIComponent(p.neighbourhood)}">${esc(p.neighbourhood)}</a>${icon("chevronRight")}
          <span aria-current="page">${esc(p.address)}</span>
        </nav>

        <div class="property-head">
          <div class="property-head__top">
            <div>
              <div class="cluster" style="margin-bottom:.6rem">
                ${statusBadge(p.status) ? statusBadge(p.status) : '<span class="badge badge--open">For sale</span>'}
                <span class="badge">${esc(p.type)}</span>
                ${p.open ? `<span class="badge badge--open">${icon("calendar")} Open ${esc(p.open)}</span>` : ""}
              </div>
              <h1>${esc(p.title)}</h1>
              <p class="property-head__addr">${icon("pin")}${esc(p.address)}, ${esc(p.city)}, ${esc(p.state)} ${esc(p.zip)} · MLS ${esc(p.mls)}</p>
            </div>
            <div class="property-head__price">
              <b>${money(p.price)}</b>
              <span>${isLand ? "Land parcel" : money(Math.round(estMonthly(p.price))) + "/mo est."} · ${p.days === 1 ? "1 day" : p.days + " days"} on market</span>
            </div>
          </div>
          <div class="property-head__actions">
            <a class="btn btn--primary" href="#enquire">${icon("calendar")} Book a viewing</a>
            <button class="btn btn--ghost js-save" type="button" data-save="${esc(p.id)}" aria-pressed="false">${icon("heart")} Save</button>
            <button class="btn btn--ghost" type="button" data-share>${icon("share")} Share</button>
          </div>
        </div>

        ${gallery}
      </div>

      <div class="container">
        <div class="property-layout">
          <div>
            <section class="panel">
              <h2>The short version</h2>
              <p class="lead" style="margin-bottom:1.25rem">${esc(p.summary)}</p>
              <div class="fact-grid">
                ${facts
                  .map(
                    (f) => `
                  <div class="fact">${icon(f.icon)}<div><b>${esc(f.value)}</b><span>${esc(f.label)}</span></div></div>`
                  )
                  .join("")}
              </div>
              ${p.highlights && p.highlights.length ? `<div class="cluster">${p.highlights.map((h) => `<span class="pill-stat">${icon("checkCircle")}${esc(h)}</span>`).join("")}</div>` : ""}
            </section>

            <section class="panel">
              <h2>About this ${isLand ? "parcel" : "home"}</h2>
              ${p.description.map((para) => `<p>${esc(para)}</p>`).join("")}
            </section>

            <section class="panel">
              <h2>Features &amp; finishes</h2>
              <ul class="feature-list">
                ${(p.features || []).map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`).join("")}
              </ul>
            </section>

            <section class="panel">
              <h2>Property details</h2>
              <div class="spec-table">
                ${Object.entries(p.specs || {})
                  .map(([k, v]) => `<div class="spec-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
                  .join("")}
                ${p.hoa ? `<div class="spec-row"><span>HOA dues</span><b>${money(p.hoa)} / month</b></div>` : ""}
                <div class="spec-row"><span>MLS reference</span><b>${esc(p.mls)}</b></div>
              </div>
            </section>

            <section class="panel">
              <h2>Location</h2>
              <p>${esc(p.neighbourhood)}, ${esc(p.city)}. Exact address and viewing arrangements confirmed with your advisor.</p>
              <div class="map-panel" style="margin-top:1rem">
                <img src="assets/img/map-panel.svg" alt="Map showing the approximate location of ${esc(p.address)}" loading="lazy" width="1200" height="900">
                <div class="map-panel__overlay">
                  ${icon("pin")}
                  <div><b>${esc(p.address)}</b><span>${esc(p.neighbourhood)} · ${esc(p.city)}, ${esc(p.state)}</span></div>
                </div>
              </div>
              <div class="cluster" style="margin-top:1rem">
                <a class="btn btn--ghost btn--sm" href="listings.html?loc=${encodeURIComponent(p.neighbourhood)}">More in ${esc(p.neighbourhood)}</a>
                <a class="btn btn--ghost btn--sm" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address + " " + p.city + " " + p.state)}" target="_blank" rel="noopener">Open in maps ${icon("external")}</a>
              </div>
            </section>

            ${isLand ? "" : `
            <section class="panel" data-calc data-price="${p.price}" data-hoa="${p.hoa || 0}">
              <h2>What would this cost per month?</h2>
              <p class="muted" style="font-size:.9rem">Adjust the numbers to see the estimated monthly payment. Figures are indicative and exclude any local fees.</p>
              <div class="calc">
                <div class="calc__output">
                  <b data-calc-total>$0</b>
                  <span>Estimated monthly payment</span>
                </div>
                <div class="calc__row">
                  <label for="calcDown">Deposit</label>
                  <output data-calc-down-out>20%</output>
                  <input type="range" id="calcDown" min="5" max="50" step="1" value="20" data-calc-down>
                </div>
                <div class="calc__row">
                  <label for="calcRate">Interest rate</label>
                  <output data-calc-rate-out>6.5%</output>
                  <input type="range" id="calcRate" min="2" max="10" step="0.05" value="6.5" data-calc-rate>
                </div>
                <div class="calc__row">
                  <label for="calcTerm">Term</label>
                  <select class="select" id="calcTerm" data-calc-term style="width:auto">
                    <option value="30">30 years</option>
                    <option value="20">20 years</option>
                    <option value="15">15 years</option>
                  </select>
                </div>
                <div class="calc__breakdown">
                  <div><span>Principal &amp; interest</span><b data-calc-pi>—</b></div>
                  <div><span>Property tax (est.)</span><b data-calc-tax>—</b></div>
                  <div><span>Insurance (est.)</span><b data-calc-ins>—</b></div>
                  ${p.hoa ? `<div><span>HOA dues</span><b data-calc-hoa>—</b></div>` : ""}
                </div>
                <p class="calc__note">Estimate only. Speak to a lender for a personalised quote — we can introduce you to three we trust.</p>
                <a class="btn btn--ghost btn--block" href="contact.html">Ask for a lender introduction</a>
              </div>
            </section>`}
          </div>

          <aside class="sidebar-sticky">
            <div class="panel agent-box" id="enquire">
              <div class="agent-box__head">
                <img src="${esc(agent.photo)}" alt="Portrait of ${esc(agent.name)}" width="62" height="62">
                <div>
                  <b>${esc(agent.name)}</b>
                  <span>${esc(agent.role)}</span>
                </div>
              </div>
              <div class="agent-box__body">
                <div class="agent-box__quick">
                  <a href="tel:${esc(agent.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} ${esc(agent.phone)}</a>
                  <a href="sms:${esc((SITE.contact.sms || "").replace(/[^\d+]/g, ""))}">${icon("message")} Text</a>
                </div>
                <form class="form" data-form="viewing" novalidate>
                  <h4 style="margin:0 0 .25rem;font-size:1.05rem">Book a private viewing</h4>
                  <p class="tiny muted" style="margin:0 0 .5rem">${esc(SITE.contact.responsePromise)}</p>
                  <input type="hidden" name="property" value="${esc(p.title + " — " + p.address)}">
                  <div class="field">
                    <label class="field__label" for="pvName">Your name <span class="req">*</span></label>
                    <input class="input" id="pvName" name="name" type="text" autocomplete="name" required placeholder="First and last name">
                    <span class="field__error"></span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="pvEmail">Email <span class="req">*</span></label>
                    <input class="input" id="pvEmail" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
                    <span class="field__error"></span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="pvPhone">Phone</label>
                    <input class="input" id="pvPhone" name="phone" type="tel" autocomplete="tel" placeholder="(555) 000-0000">
                    <span class="field__error"></span>
                  </div>
                  <div class="field">
                    <label class="field__label" for="pvDay">Preferred day</label>
                    <select class="select" id="pvDay" name="preferred">
                      <option>This weekend</option>
                      <option>Weekday daytime</option>
                      <option>Weekday evening</option>
                      <option>I'll arrange with the agent</option>
                    </select>
                  </div>
                  <div class="field">
                    <label class="field__label" for="pvMsg">Message</label>
                    <textarea class="textarea" id="pvMsg" name="message" rows="3" style="min-height:84px" placeholder="Anything we should know?">I'd like to view ${esc(p.address)}.</textarea>
                  </div>
                  <button class="btn btn--primary btn--block" type="submit">Request viewing ${icon("arrowRight")}</button>
                  <div class="form-status" data-form-status role="status" aria-live="polite"></div>
                  <p class="tiny muted" style="margin:0">By sending this you agree to be contacted about this property. No spam, ever.</p>
                </form>
              </div>
            </div>

            <div class="panel">
              <h3 style="font-family:var(--font-display);font-size:1.15rem">Thinking of selling something similar?</h3>
              <p class="muted" style="font-size:.9rem">We have 340 qualified buyers on our private list. Ask for a no-obligation valuation of your current home.</p>
              <a class="btn btn--accent btn--block" href="sell.html#valuation">Get my free valuation</a>
            </div>
          </aside>
        </div>
      </div>

      ${
        similar.length
          ? `<section class="section section--tint">
        <div class="container">
          <div class="section__head section__head--row">
            <div>
              <span class="eyebrow">You may also like</span>
              <h2>Similar homes near ${esc(p.neighbourhood)}</h2>
            </div>
            <a class="link-arrow" href="listings.html?loc=${encodeURIComponent(p.neighbourhood)}">View all ${esc(p.neighbourhood)} homes ${icon("arrowRight")}</a>
          </div>
          <div class="grid grid--3">${similar.map(listingCard).join("")}</div>
        </div>
      </section>`
          : ""
      }

      <div class="property-bar" data-property-bar>
        <div class="property-bar__price">${money(p.price)}<small>${esc(p.address)}</small></div>
        <div class="cluster" style="gap:.4rem">
          <a class="btn btn--ghost btn--sm" href="tel:${esc(agent.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} Call</a>
          <a class="btn btn--primary btn--sm" href="#enquire">Book viewing</a>
        </div>
      </div>`;

    document.title = `${p.title} — ${money(p.price)} | ${SITE.brand.name} ${SITE.brand.suffix}`;
    initForms(root);
    initCalc(root);
    initPropertyBar();
    injectPropertySchema(p);

    /* gallery lightbox */
    const lb = getLightbox();
    $$("[data-lightbox-index]", root).forEach((btn) => {
      btn.addEventListener("click", () => lb.open(p.images, Number(btn.dataset.lightboxIndex), p.address));
    });
  }

  function injectPropertySchema(p) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SingleFamilyResidence",
      name: p.title,
      description: p.summary,
      numberOfRooms: p.beds || undefined,
      numberOfBathroomsTotal: p.baths || undefined,
      floorSize: p.sqft ? { "@type": "QuantitativeValue", value: p.sqft, unitCode: "FTK" } : undefined,
      address: {
        "@type": "PostalAddress",
        streetAddress: p.address,
        addressLocality: p.city,
        addressRegion: p.state,
        postalCode: p.zip,
        addressCountry: "US",
      },
      offers: { "@type": "Offer", price: p.price, priceCurrency: "USD", availability: p.status === "Sold" ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
    });
    document.head.appendChild(script);
  }

  function initPropertyBar() {
    const bar = $("[data-property-bar]");
    if (!bar || !SITE.features || !SITE.features.propertyBar) return;
    const offset = (SITE.features && SITE.features.propertyBarOffset) || 700;
    const onScroll = () => bar.classList.toggle("is-visible", window.scrollY > offset);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ======================================================================
     9. Agent profile page
     ====================================================================== */
  function initAgent() {
    const root = document.getElementById("agentApp");
    if (!root) return;
    const a = DATA.agents.find((x) => x.id === params().get("id")) || DATA.agents[0];
    document.title = `${a.name} — ${a.role} | ${SITE.brand.name} ${SITE.brand.suffix}`;

    const listings = DATA.properties.filter((p) => p.agentId === a.id);
    const testimonials = DATA.testimonials.slice(0, 3);

    root.innerHTML = `
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="index.html">Home</a>${icon("chevronRight")}
          <a href="agents.html">Our agents</a>${icon("chevronRight")}
          <span aria-current="page">${esc(a.name)}</span>
        </nav>

        <div class="profile">
          <div>
            <div class="profile__media">
              <img src="${esc(a.photo)}" alt="Portrait of ${esc(a.name)}" width="700" height="780">
            </div>
            <div class="profile__contact">
              <a href="tel:${esc(a.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} ${esc(a.phone)}</a>
              <a href="mailto:${esc(a.email)}">${icon("mail")} ${esc(a.email)}</a>
              <a href="#contact-agent">${icon("message")} Send a message</a>
            </div>
          </div>

          <div>
            <span class="eyebrow">${esc(a.role)}</span>
            <h1>${esc(a.name)}</h1>
            <div class="cluster" style="margin-bottom:1.25rem">
              ${stars(a.rating)}
              <span class="tiny muted">${a.rating.toFixed(1)} from ${a.reviews} verified reviews</span>
            </div>
            ${a.bio.map((para) => `<p class="lead">${esc(para)}</p>`).join("")}

            <div class="profile__stats">
              <div><b>${a.deals}</b><span>Deals closed</span></div>
              <div><b>${esc(a.volume)}</b><span>Total volume</span></div>
              <div><b>${new Date().getFullYear() - a.since}+</b><span>Years experience</span></div>
            </div>

            <h3 style="font-family:var(--font-display);font-size:1.2rem">Specialisms</h3>
            <div class="tag-list" style="margin-bottom:1.5rem">${a.specialties.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>

            <h3 style="font-family:var(--font-display);font-size:1.2rem">Details</h3>
            <div class="spec-table" style="margin-bottom:1.75rem">
              <div class="spec-row"><span>Languages</span><b>${esc(a.languages.join(", "))}</b></div>
              <div class="spec-row"><span>Licence</span><b>${esc(a.license || "—")}</b></div>
              <div class="spec-row"><span>With ${esc(SITE.brand.name)} since</span><b>${a.since}</b></div>
              <div class="spec-row"><span>Active listings</span><b>${listings.length}</b></div>
            </div>

            ${
              a.testimonial
                ? `<div class="quote-card" style="margin-bottom:1.75rem">
                    <span class="quote-card__mark">“</span>
                    <blockquote>${esc(a.testimonial.quote)}</blockquote>
                    <div class="quote-card__person">
                      <div><b>${esc(a.testimonial.name)}</b><span>${esc(a.testimonial.location)}</span></div>
                    </div>
                  </div>`
                : ""
            }

            <div class="panel" id="contact-agent">
              <h2>Message ${esc(a.name.split(" ")[0])} directly</h2>
              <form class="form form--inline" data-form="agent-contact" novalidate>
                <input type="hidden" name="agent" value="${esc(a.name)}">
                <div class="field">
                  <label class="field__label" for="agName">Your name <span class="req">*</span></label>
                  <input class="input" id="agName" name="name" type="text" required autocomplete="name">
                  <span class="field__error"></span>
                </div>
                <div class="field">
                  <label class="field__label" for="agEmail">Email <span class="req">*</span></label>
                  <input class="input" id="agEmail" name="email" type="email" required autocomplete="email">
                  <span class="field__error"></span>
                </div>
                <div class="field">
                  <label class="field__label" for="agPhone">Phone</label>
                  <input class="input" id="agPhone" name="phone" type="tel" autocomplete="tel">
                </div>
                <div class="field">
                  <label class="field__label" for="agTopic">I'm interested in</label>
                  <select class="select" id="agTopic" name="topic">
                    <option>Buying a home</option>
                    <option>Selling my home</option>
                    <option>Investment property</option>
                    <option>Just exploring</option>
                  </select>
                </div>
                <div class="field field--full">
                  <label class="field__label" for="agMsg">Message <span class="req">*</span></label>
                  <textarea class="textarea" id="agMsg" name="message" required placeholder="Tell us a little about what you're looking for…"></textarea>
                  <span class="field__error"></span>
                </div>
                <div class="field--full">
                  <button class="btn btn--primary" type="submit">Send message ${icon("arrowRight")}</button>
                </div>
                <div class="form-status field--full" data-form-status role="status" aria-live="polite"></div>
              </form>
            </div>
          </div>
        </div>
      </div>

      ${
        listings.length
          ? `<section class="section section--tint">
              <div class="container">
                <div class="section__head section__head--row">
                  <div>
                    <span class="eyebrow">Current portfolio</span>
                    <h2>${esc(a.name.split(" ")[0])}'s active listings</h2>
                  </div>
                  <a class="link-arrow" href="listings.html">All listings ${icon("arrowRight")}</a>
                </div>
                <div class="grid grid--3">${listings.slice(0, 3).map(listingCard).join("")}</div>
              </div>
            </section>`
          : ""
      }

      <section class="section">
        <div class="container">
          <div class="section__head section__head--center">
            <span class="eyebrow">Client reviews</span>
            <h2>What it's like to work with us</h2>
          </div>
          <div class="grid grid--3">
            ${testimonials
              .map(
                (t) => `
              <div class="quote-card">
                <span class="quote-card__mark">“</span>
                ${stars(t.rating)}
                <blockquote>${esc(t.quote)}</blockquote>
                <div class="quote-card__person">
                  <img src="${esc(t.avatar)}" alt="" width="44" height="44">
                  <div><b>${esc(t.name)}</b><span>${esc(t.location)}</span></div>
                </div>
              </div>`
              )
              .join("")}
          </div>
        </div>
      </section>`;

    initForms(root);
    updateSavedCount();
  }

  /* ======================================================================
     10. Article page
     ====================================================================== */
  function initPost() {
    const root = document.getElementById("postApp");
    if (!root) return;
    const id = params().get("id");
    const post = postById(id) || DATA.posts[0];
    const author = agentById(post.authorId) || DATA.agents[0];
    document.title = `${post.title} | ${SITE.brand.name} ${SITE.brand.suffix}`;

    const bodyHTML = post.body
      .map((block) => {
        if (block.type === "h2") return `<h2>${esc(block.text)}</h2>`;
        if (block.type === "quote") return `<blockquote><p>${esc(block.text)}</p></blockquote>`;
        if (block.type === "ul") return `<ul>${block.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
        if (block.type === "img") return `<img src="${esc(block.src)}" alt="${esc(block.alt || "")}">`;
        return `<p>${esc(block.text)}</p>`;
      })
      .join("");

    const related = DATA.posts.filter((b) => b.id !== post.id).slice(0, 3);

    root.innerHTML = `
      <div class="container container--narrow">
        <nav class="breadcrumb" aria-label="Breadcrumb">
          <a href="index.html">Home</a>${icon("chevronRight")}
          <a href="blog.html">Insights</a>${icon("chevronRight")}
          <span aria-current="page">${esc(post.category)}</span>
        </nav>
        <header class="post-header">
          <span class="eyebrow">${esc(post.category)}</span>
          <h1>${esc(post.title)}</h1>
          <div class="post-meta" style="margin-top:1.25rem">
            <span class="post-meta__author"><img src="${esc(author.photo)}" alt="" width="34" height="34">${esc(author.name)}</span>
            <span>${fmtDate(post.date)}</span><span>·</span><span>${post.readTime} min read</span>
          </div>
        </header>
        <div class="post-cover">
          <img src="${esc(post.image)}" alt="" width="1600" height="685">
        </div>
      </div>

      <div class="container">
        <div class="post-layout section--tight">
          <article class="prose">
            <p class="lead">${esc(post.excerpt)}</p>
            ${bodyHTML}
            <div class="share-row">
              <span>Share this article</span>
              <button class="share-btn" type="button" data-share aria-label="Copy link">${icon("link")}</button>
              <a class="share-btn" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener" aria-label="Share on X">${icon("external")}</a>
              <a class="share-btn" href="https://www.facebook.com/sharer/sharer.php?u=" target="_blank" rel="noopener" aria-label="Share on Facebook">${icon("facebook")}</a>
              <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/" target="_blank" rel="noopener" aria-label="Share on LinkedIn">${icon("linkedin")}</a>
            </div>
          </article>

          <aside class="sidebar-sticky">
            <div class="panel">
              <h3 style="font-family:var(--font-display);font-size:1.15rem">About the author</h3>
              <div class="agent-box__head" style="padding:0;border:0;margin-bottom:.75rem">
                <img src="${esc(author.photo)}" alt="" width="56" height="56" style="width:56px;height:56px">
                <div><b>${esc(author.name)}</b><span>${esc(author.role)}</span></div>
              </div>
              <p class="muted" style="font-size:.88rem">${esc(author.bio[0])}</p>
              <a class="btn btn--ghost btn--sm btn--block" href="agent.html?id=${encodeURIComponent(author.id)}">View profile</a>
            </div>

            <div class="panel">
              <h3 style="font-family:var(--font-display);font-size:1.15rem">Talk to a local expert</h3>
              <p class="muted" style="font-size:.88rem">${esc(SITE.contact.responsePromise)}</p>
              <form class="form" data-form="article-enquiry" novalidate>
                <div class="field">
                  <label class="field__label" for="blEmail">Email <span class="req">*</span></label>
                  <input class="input" id="blEmail" name="email" type="email" required placeholder="you@example.com">
                  <span class="field__error"></span>
                </div>
                <div class="field">
                  <label class="field__label" for="blMsg">How can we help?</label>
                  <textarea class="textarea" id="blMsg" name="message" rows="3" style="min-height:80px" placeholder="I read your article on…"></textarea>
                </div>
                <button class="btn btn--primary btn--block" type="submit">Get in touch</button>
                <div class="form-status" data-form-status role="status" aria-live="polite"></div>
              </form>
            </div>
          </aside>
        </div>
      </div>

      <section class="section section--tint">
        <div class="container">
          <div class="section__head section__head--row">
            <div><span class="eyebrow">Keep reading</span><h2>More from the insights desk</h2></div>
            <a class="link-arrow" href="blog.html">All articles ${icon("arrowRight")}</a>
          </div>
          <div class="grid grid--3">${related.map((p) => postCard(p)).join("")}</div>
        </div>
      </section>`;

    initForms(root);
  }

  /* ======================================================================
     11. Testimonial slider
     ====================================================================== */
  function initSliders() {
    $$("[data-slider]").forEach((slider) => {
      if (slider.dataset.bound) return;
      slider.dataset.bound = "1";
      const track = $(".slider__track", slider);
      const slides = $$(".quote-card", track);
      const prev = $("[data-slider-prev]", slider);
      const next = $("[data-slider-next]", slider);
      const dotsHost = $("[data-slider-dots]", slider);
      if (!track || !slides.length) return;

      let index = 0;
      let timer = null;

      const perView = () => {
        const w = window.innerWidth;
        return w > 1000 ? 3 : w > 700 ? 2 : 1;
      };
      const maxIndex = () => Math.max(0, slides.length - perView());

      function buildDots() {
        if (!dotsHost) return;
        dotsHost.innerHTML = Array.from({ length: maxIndex() + 1 }, (_, i) => `<button class="slider__dot" type="button" role="tab" aria-label="Go to review group ${i + 1}" data-dot="${i}" aria-selected="${i === index}"></button>`).join("");
      }
      function apply() {
        const slideW = slides[0].getBoundingClientRect().width;
        const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || "0") || 0;
        track.style.transform = `translateX(${-index * (slideW + gap)}px)`;
        if (dotsHost) {
          $$("[data-dot]", dotsHost).forEach((d) => d.setAttribute("aria-selected", String(Number(d.dataset.dot) === index)));
        }
      }
      function go(delta) {
        index = clamp(index + delta, 0, maxIndex());
        apply();
      }
      function auto() {
        if (timer) clearInterval(timer);
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        timer = setInterval(() => {
          index = index >= maxIndex() ? 0 : index + 1;
          apply();
        }, 6500);
      }

      if (prev) prev.addEventListener("click", () => { go(-1); auto(); });
      if (next) next.addEventListener("click", () => { go(1); auto(); });
      if (dotsHost) {
        dotsHost.addEventListener("click", (e) => {
          const dot = e.target.closest("[data-dot]");
          if (!dot) return;
          index = Number(dot.dataset.dot);
          apply();
          auto();
        });
      }
      slider.addEventListener("mouseenter", () => timer && clearInterval(timer));
      slider.addEventListener("mouseleave", auto);
      slider.addEventListener("focusin", () => timer && clearInterval(timer));
      slider.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      });

      buildDots();
      apply();
      auto();
      window.addEventListener(
        "resize",
        debounce(() => {
          index = clamp(index, 0, maxIndex());
          buildDots();
          apply();
        }, 150)
      );
    });
  }

  /* ======================================================================
     12. Mortgage calculator
     ====================================================================== */
  function initCalc(root = document) {
    $$("[data-calc]", root).forEach((calc) => {
      if (calc.dataset.bound) return;
      calc.dataset.bound = "1";
      const price = Number(calc.dataset.price) || 750000;
      const hoa = Number(calc.dataset.hoa) || 0;
      const down = $("[data-calc-down]", calc);
      const rate = $("[data-calc-rate]", calc);
      const term = $("[data-calc-term]", calc);
      const totalOut = $("[data-calc-total]", calc);
      const piOut = $("[data-calc-pi]", calc);
      const taxOut = $("[data-calc-tax]", calc);
      const insOut = $("[data-calc-ins]", calc);
      const hoaOut = $("[data-calc-hoa]", calc);
      const downOut = $("[data-calc-down-out]", calc);
      const rateOut = $("[data-calc-rate-out]", calc);

      function update() {
        const downPct = down ? Number(down.value) : 20;
        const rateVal = rate ? Number(rate.value) : 6.5;
        const years = term ? Number(term.value) : 30;
        const principal = price * (1 - downPct / 100);
        const pi = monthlyPayment(principal, rateVal, years);
        const tax = (price * 0.0114) / 12;
        const ins = (price * 0.0035) / 12;
        const total = pi + tax + ins + hoa;

        if (totalOut) totalOut.textContent = money(Math.round(total));
        if (piOut) piOut.textContent = money(Math.round(pi));
        if (taxOut) taxOut.textContent = money(Math.round(tax));
        if (insOut) insOut.textContent = money(Math.round(ins));
        if (hoaOut) hoaOut.textContent = money(hoa);
        if (downOut) downOut.textContent = downPct + "% · " + money(Math.round(price * (downPct / 100)));
        if (rateOut) rateOut.textContent = rateVal.toFixed(2) + "%";
      }

      [down, rate, term].forEach((el) => el && el.addEventListener("input", update));
      update();
    });
  }

  /* ======================================================================
     12b. Seller net-proceeds calculator (sell.html)
     ====================================================================== */
  function initNetCalc(root = document) {
    $$("[data-netc]", root).forEach((box) => {
      if (box.dataset.bound) return;
      box.dataset.bound = "1";
      const priceEl = $("[data-netc-price]", box);
      const loanEl = $("[data-netc-loan]", box);
      const feeEl = $("[data-netc-fee]", box);
      if (!priceEl || !loanEl || !feeEl) return;

      const priceOut = $("[data-netc-price-out]", box);
      const loanOut = $("[data-netc-loan-out]", box);
      const feeOut = $("[data-netc-fee-out]", box);
      const netOut = $("[data-netc-out]", box);
      const grossOut = $("[data-netc-gross]", box);
      const commOut = $("[data-netc-comm]", box);
      const payoffOut = $("[data-netc-payoff]", box);
      const closingOut = $("[data-netc-closing]", box);
      const CLOSING_RATE = 0.011; // local transfer + escrow, editable

      function update() {
        const price = Number(priceEl.value);
        const loan = Math.min(Number(loanEl.value), price);
        const fee = Number(feeEl.value);
        const commission = price * (fee / 100);
        const closing = price * CLOSING_RATE;
        const net = price - commission - closing - loan;

        if (priceOut) priceOut.textContent = money(price);
        if (loanOut) loanOut.textContent = money(loan);
        if (feeOut) feeOut.textContent = fee.toFixed(2).replace(/\.00$/, "") + "%";
        if (netOut) netOut.textContent = money(Math.max(0, Math.round(net)));
        if (grossOut) grossOut.textContent = money(price);
        if (commOut) commOut.textContent = "− " + money(Math.round(commission));
        if (payoffOut) payoffOut.textContent = "− " + money(loan);
        if (closingOut) closingOut.textContent = "− " + money(Math.round(closing));
      }
      [priceEl, loanEl, feeEl].forEach((el) => el.addEventListener("input", update));
      update();
    });
  }

  /* ======================================================================
     13. Lightbox, favourites, floaters
     ====================================================================== */

  /* ----------------------------------------------------------------------
     Keep hand-written page content in sync with config.js.
     Any <a href="tel:…">, <a href="mailto:…">, <a href="sms:…"> anywhere in
     the markup (including inside page copy and CTAs) is repointed at the
     values in SITE.contact, and any [data-site="a.b.c"] element gets its text
     replaced with that value from SITE. So a client's phone number and
     licence only ever live in one place.
     ---------------------------------------------------------------------- */
  function normalizeContactLinks() {
    const c = SITE.contact || {};
    const PHONE_TEXT = /^[\d\s()+.\-]{7,}$/;
    const EMAIL_TEXT = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

    if (c.phone) {
      $$('a[href^="tel:"]').forEach((a) => {
        a.setAttribute("href", "tel:" + c.phone);
        const text = a.textContent.trim();
        if (c.phoneDisplay && PHONE_TEXT.test(text)) a.textContent = c.phoneDisplay;
      });
    }
    if (c.email) {
      $$('a[href^="mailto:"]').forEach((a) => {
        a.setAttribute("href", "mailto:" + c.email);
        const text = a.textContent.trim();
        if (EMAIL_TEXT.test(text)) a.textContent = c.email;
      });
    }
    if (c.sms) {
      $$('a[href^="sms:"]').forEach((a) => a.setAttribute("href", "sms:" + c.sms));
    }

    $$("[data-site]").forEach((el) => {
      const value = el.dataset.site.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), SITE);
      if (value != null && typeof value !== "object") el.textContent = value;
    });
  }  let lightbox = null;
  function getLightbox() {
    if (lightbox) return lightbox;
    const el = document.createElement("div");
    el.className = "lightbox";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Property photos");
    el.innerHTML = `
      <button class="lightbox__close" type="button" aria-label="Close photos">${icon("close")}</button>
      <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous photo">${icon("chevronLeft")}</button>
      <img class="lightbox__img" src="" alt="">
      <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next photo">${icon("chevronRight")}</button>
      <p class="lightbox__caption"></p>`;
    document.body.appendChild(el);

    let images = [];
    let index = 0;
    let caption = "";

    const imgEl = $(".lightbox__img", el);
    const capEl = $(".lightbox__caption", el);

    function paint() {
      imgEl.src = images[index];
      imgEl.alt = `${caption} — photo ${index + 1} of ${images.length}`;
      capEl.textContent = `${caption} · ${index + 1} / ${images.length}`;
    }
    function close() {
      el.classList.remove("is-open");
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") { index = (index + 1) % images.length; paint(); }
      if (e.key === "ArrowLeft") { index = (index - 1 + images.length) % images.length; paint(); }
    }

    $(".lightbox__close", el).addEventListener("click", close);
    $(".lightbox__nav--prev", el).addEventListener("click", () => { index = (index - 1 + images.length) % images.length; paint(); });
    $(".lightbox__nav--next", el).addEventListener("click", () => { index = (index + 1) % images.length; paint(); });
    el.addEventListener("click", (e) => { if (e.target === el) close(); });

    lightbox = {
      open(list, startIndex = 0, cap = "") {
        images = list.slice();
        index = startIndex;
        caption = cap;
        paint();
        el.classList.add("is-open");
        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", onKey);
        $(".lightbox__close", el).focus();
      },
      close,
    };
    return lightbox;
  }

  function updateSavedCount() {
    const list = store.get();
    $$("[data-saved-count]").forEach((n) => {
      n.textContent = String(list.length);
      n.style.display = list.length ? "" : "none";
    });
    $$("[data-save]").forEach((btn) => {
      const on = list.includes(btn.dataset.save);
      btn.classList.toggle("is-saved", on);
      btn.setAttribute("aria-pressed", String(on));
      if (btn.classList.contains("btn")) {
        const label = btn.dataset.label || (btn.dataset.save ? "" : "");
        btn.innerHTML = on ? icon("heart") + " Saved" : icon("heart") + " Save";
      }
    });
  }

  function initSaveDelegation() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-save]");
      if (!btn) return;
      e.preventDefault();
      const id = btn.dataset.save;
      const list = store.get();
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      else list.push(id);
      store.set(list);
      updateSavedCount();
      if (window.__listingsSyncSaved) window.__listingsSyncSaved();
      if (window.__listingsRender) window.__listingsRender();
    });
  }

  function initShareButtons() {
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-share]");
      if (!btn) return;
      e.preventDefault();
      const url = window.location.href;
      const title = document.title;
      try {
        if (navigator.share) {
          await navigator.share({ title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        const original = btn.innerHTML;
        btn.innerHTML = icon("check") + " Link copied";
        setTimeout(() => (btn.innerHTML = original), 1900);
      } catch (err) {
        window.prompt("Copy this link:", url);
      }
    });
  }

  function initFloaters() {
    /* back to top */
    if (!SITE.features || SITE.features.toTop !== false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "to-top";
      btn.setAttribute("aria-label", "Back to top");
      btn.innerHTML = icon("arrowUp");
      document.body.appendChild(btn);
      btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
      const onScroll = () => btn.classList.toggle("is-visible", window.scrollY > 900);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    /* contact fab */
    if (!SITE.features || SITE.features.contactFab !== false) {
      const a = document.createElement("a");
      a.className = "contact-fab";
      a.href = "contact.html";
      a.innerHTML = icon("message") + "<span>Talk to an agent</span>";
      document.body.appendChild(a);
    }
  }

  /* search bar on the home page */
  function initSearchForms() {
    $$("[data-search-form]").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const qs = new URLSearchParams();
        ["q", "loc", "type", "beds", "max", "status"].forEach((k) => {
          const v = fd.get(k);
          if (v) qs.set(k, String(v));
        });
        window.location.href = "listings.html" + (qs.toString() ? "?" + qs.toString() : "");
      });
    });

    /* buy / sell tabs */
    $$("[data-tab-group]").forEach((group) => {
      const tabs = $$("[data-tab]", group);
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
          $$("[data-panel]", group).forEach((panel) => {
            const show = panel.dataset.panel === tab.dataset.tab;
            panel.hidden = !show;
          });
        });
      });
    });

    /* quick-search chips */
    $$("[data-quicksearch]").forEach((link) => {
      link.addEventListener("click", () => {
        /* navigates naturally; hook kept for analytics */
      });
    });
  }

  /* ======================================================================
     14. Boot
     ====================================================================== */
  function boot() {
    const page = document.body.dataset.page || currentPage().replace(".html", "");

    mountHeader();
    mountFooter();

    /* shared renderers */
    renderStats();
    renderFeatured();
    renderNeighbourhoods();
    renderAgents();
    renderPosts();
    renderFaqs();
    renderOffices();

    /* sliders are built from data on any page that has a slider host */
    $$("[data-slider]").forEach((slider) => {
      const track = $(".slider__track", slider);
      if (track && !track.children.length) {
        track.innerHTML = DATA.testimonials
          .map(
            (t) => `
          <div class="quote-card">
            <span class="quote-card__mark">“</span>
            ${stars(t.rating)}
            <blockquote>${esc(t.quote)}</blockquote>
            <div class="quote-card__person">
              <img src="${esc(t.avatar)}" alt="" width="44" height="44">
              <div><b>${esc(t.name)}</b><span>${esc(t.location)}</span></div>
            </div>
          </div>`
          )
          .join("");
      }
    });

    /* page-specific */
    if (page === "property") initProperty();
    if (page === "agent") initAgent();
    if (page === "post") initPost();
    if (page === "listings" || document.getElementById("listingsApp")) initListings();

    initSearchForms();
    initSaveDelegation();
    initShareButtons();
    initSliders();
    initCalc();
    initNetCalc();
    initForms();
    initReveal();
    initCounters();
    initFloaters();
    normalizeContactLinks();
    updateSavedCount();

    /* blog category filter */
    $$("[data-post-filter]").forEach((group) => {
      group.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-category-value]");
        if (!btn) return;
        const cat = btn.dataset.categoryValue;
        $$("[data-category-value]", group).forEach((b) => b.classList.toggle("is-active", b === btn));
        $$("[data-render='posts'] [data-category]").forEach((card) => {
          card.hidden = Boolean(cat) && card.dataset.category !== cat;
        });
      });
    });

    document.documentElement.classList.add("js-ready");
    console.log(`%c${SITE.brand.name} ${SITE.brand.suffix} template ready`, "color:#0e5b4e;font-weight:600", `— page: ${page}`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
