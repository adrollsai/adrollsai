/* ==========================================================================
   EVERLINE REALTY — SITE CONFIG
   --------------------------------------------------------------------------
   ⭐ THIS IS THE ONLY FILE YOU NEED TO EDIT TO RE-BRAND THE ENTIRE TEMPLATE.
   The header, footer, top bar, buttons, forms and every contact detail are
   generated from this object by assets/js/app.js.

   Replace the values below with your client's details, save, refresh.
   Nothing else needs to change.
   ========================================================================== */

window.SITE = {
  /* ---------------------------------------------------------------- brand */
  brand: {
    name: "Everline",           // wordmark line 1
    suffix: "Realty",           // wordmark line 2 (set "" to hide)
    tagline: "Homes with a higher standard",
    mark: "assets/img/logo-mark.svg",
    license: "CA DRE #02134567",   // shown in the footer
    founded: 2009,
  },

  /* -------------------------------------------------------------- contact */
  contact: {
    phone: "+1-555-018-2245",
    phoneDisplay: "(555) 018-2245",
    sms: "+1-555-018-2245",
    whatsapp: "15550182245",       // digits only, no +
    email: "hello@everlinerealty.com",
    emailSales: "sales@everlinerealty.com",
    address: {
      line1: "2140 Alder Street, Suite 300",
      line2: "Riverton, CA 94107",
      street: "2140 Alder Street, Suite 300, Riverton, CA 94107",
      mapsQuery: "2140 Alder Street Riverton CA",
    },
    hours: [
      { days: "Monday – Friday", time: "8:30am – 6:30pm" },
      { days: "Saturday", time: "10:00am – 4:00pm" },
      { days: "Sunday", time: "By appointment" },
    ],
    responsePromise: "We reply to every enquiry within 1 business hour.",
  },

  /* ---------------------------------------------------------------- market */
  market: {
    city: "Riverton",
    region: "CA",
    metro: "Riverton & the Bay Metro",
    mls: "Riverton MLS",
    currency: "USD",
    locale: "en-US",
  },

  /* ------------------------------------------------------------ proof/trust */
  rating: { score: 4.9, count: 218, source: "Google" },

  stats: [
    { value: 1450, suffix: "+", label: "Homes sold" },
    { value: 1.8, prefix: "$", suffix: "B", label: "Total volume", decimals: 1 },
    { value: 16, suffix: " yrs", label: "In the market" },
    { value: 98, suffix: "%", label: "List-to-sale ratio" },
  ],

  /* ------------------------------------------------------------------- nav */
  nav: [
    { label: "Home", href: "index.html" },
    { label: "Listings", href: "listings.html" },
    { label: "Sell", href: "sell.html" },
    { label: "Services", href: "services.html" },
    { label: "Agents", href: "agents.html" },
    { label: "Insights", href: "blog.html" },
    { label: "About", href: "about.html" },
  ],

  /* ------------------------------------------------------------------- cta */
  cta: {
    label: "Book a consultation",
    href: "contact.html",
    note: "Free, no-obligation 30-minute call",
  },

  /* ----------------------------------------------------------------- icons */
  /* Keys map to inline SVG sprites in app.js. Add or remove as needed.     */
  social: [
    { label: "Instagram", icon: "instagram", href: "https://instagram.com/" },
    { label: "Facebook", icon: "facebook", href: "https://facebook.com/" },
    { label: "LinkedIn", icon: "linkedin", href: "https://linkedin.com/" },
    { label: "YouTube", icon: "youtube", href: "https://youtube.com/" },
  ],

  /* ---------------------------------------------------------------- footer */
  footer: {
    blurb:
      "A boutique brokerage built on local knowledge, sharp negotiation and a genuine duty of care. We sell homes, not square footage.",
    columns: [
      {
        title: "Explore",
        links: [
          { label: "All listings", href: "listings.html" },
          { label: "New this week", href: "listings.html?status=New" },
          { label: "Open houses", href: "listings.html?open=1" },
          { label: "Neighbourhoods", href: "listings.html#neighbourhoods" },
          { label: "Recently sold", href: "listings.html?status=Sold" },
        ],
      },
      {
        title: "Services",
        links: [
          { label: "Buying", href: "services.html" },
          { label: "Selling", href: "sell.html" },
          { label: "Home valuation", href: "sell.html#valuation" },
          { label: "Investment property", href: "services.html" },
          { label: "Relocation", href: "services.html" },
        ],
      },
      {
        title: "Company",
        links: [
          { label: "About us", href: "about.html" },
          { label: "Our agents", href: "agents.html" },
          { label: "Insights", href: "blog.html" },
          { label: "Reviews", href: "about.html#reviews" },
          { label: "Contact", href: "contact.html" },
        ],
      },
    ],
    legal: [
      { label: "Privacy policy", href: "privacy.html" },
      { label: "Terms of use", href: "terms.html" },
      { label: "Accessibility", href: "contact.html" },
      { label: "Fair housing", href: "contact.html" },
    ],
    disclaimer:
      "All information provided is deemed reliable but is not guaranteed and should be independently verified. Properties are subject to prior sale, change or withdrawal.",
  },

  /* ---------------------------------------------------------------- forms */
  /*
    Where enquiries go. Leave endpoint empty to use the built-in demo mode,
    which validates the form, shows a success state and forwards the visitor
    to forms.redirect. Drop in a Formspree / Netlify / HubSpot / your-API URL
    and every form on the site posts there as JSON automatically.
  */
  forms: {
    endpoint: "",                 // e.g. "https://formspree.io/f/xxxxxxx"
    method: "POST",
    redirect: "thank-you.html",
    demoRedirect: true,           // set false to stay on-page after submit
  },

  /* ------------------------------------------------------- listings page */
  searchOptions: {
    types: ["House", "Condo", "Townhouse", "Multi-family", "Land"],
    priceMax: [400000, 600000, 800000, 1250000, 2000000, 5000000],
    beds: [1, 2, 3, 4, 5],
    baths: [1, 2, 3, 4],
    statuses: ["For Sale", "New", "Open house", "Pending", "Sold"],
  },

  /* ------------------------------------------------------- feature flags */
  features: {
    favourites: true,            // heart/save listings to localStorage
    propertyBar: true,           // sticky buy bar on mobile property pages
    contactFab: true,            // floating "talk to an agent" button
    toTop: true,
    counters: true,              // animate the stat numbers
    propertyBarOffset: 700,
  },
};

/* ==========================================================================
   NOBOGENT DYNAMIC REBRANDING, COLOR THEMING & SMOOTH PAGE TRANSITION ENGINE
   ========================================================================== */
(function () {
  const urlParams = new URLSearchParams(window.location.search);
  let savedBranding = null;
  try {
    savedBranding = JSON.parse(sessionStorage.getItem('nobogent_branding') || '{}');
  } catch (e) {
    savedBranding = {};
  }

  // Extract params with fallback to sessionStorage
  const companyName = urlParams.get('companyName') || savedBranding.companyName || '';
  const projectTitle = urlParams.get('projectTitle') || savedBranding.projectTitle || '';
  const projectPrice = urlParams.get('projectPrice') || savedBranding.projectPrice || '';
  const location = urlParams.get('location') || savedBranding.location || '';
  const phone = urlParams.get('phone') || savedBranding.phone || '';
  const logoUrl = urlParams.get('logoUrl') || savedBranding.logoUrl || '';
  const heroImage = urlParams.get('heroImage') || savedBranding.heroImage || '';
  const themeColor = urlParams.get('themeColor') || savedBranding.themeColor || '';
  const accentColor = urlParams.get('accentColor') || savedBranding.accentColor || '';

  // Persist into sessionStorage so all sub-pages (listings, about, property, contact) retain the branding!
  const currentBranding = {
    companyName, projectTitle, projectPrice, location, phone, logoUrl, heroImage, themeColor, accentColor
  };
  try {
    sessionStorage.setItem('nobogent_branding', JSON.stringify(currentBranding));
  } catch (e) {}

  // 1. Dynamic Color Theming
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function adjustBrightness(hex, percent) {
    try {
      const { r, g, b } = hexToRgb(hex);
      const factor = 1 + percent / 100;
      const nr = Math.max(0, Math.min(255, Math.round(r * factor)));
      const ng = Math.max(0, Math.min(255, Math.round(g * factor)));
      const nb = Math.max(0, Math.min(255, Math.round(b * factor)));
      return '#' + [nr, ng, nb].map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return hex;
    }
  }

  if (themeColor && themeColor.startsWith('#')) {
    const root = document.documentElement;
    const brandDark = adjustBrightness(themeColor, -26);
    try {
      const { r, g, b } = hexToRgb(themeColor);
      const brandSoft = `rgba(${r}, ${g}, ${b}, 0.12)`;
      root.style.setProperty('--brand', themeColor);
      root.style.setProperty('--brand-dark', brandDark);
      root.style.setProperty('--brand-soft', brandSoft);
    } catch (e) {}

    if (accentColor && accentColor.startsWith('#')) {
      const accentDark = adjustBrightness(accentColor, -20);
      try {
        const { r, g, b } = hexToRgb(accentColor);
        const accentSoft = `rgba(${r}, ${g}, ${b}, 0.15)`;
        root.style.setProperty('--accent', accentColor);
        root.style.setProperty('--accent-dark', accentDark);
        root.style.setProperty('--accent-soft', accentSoft);
        root.style.setProperty('--ring', `0 0 0 3px rgba(${r}, ${g}, ${b}, 0.45)`);
      } catch (e) {}
    }
  }

  // 2. Re-brand window.SITE
  if (companyName) {
    window.SITE.brand.name = companyName;
    window.SITE.brand.suffix = "";
    window.SITE.brand.tagline = "Luxury Collection";
    window.SITE.brand.license = "RERA Approved • Luxury Verified";
  }

  if (logoUrl && logoUrl.startsWith('http')) {
    window.SITE.brand.mark = logoUrl;
  }

  if (phone) {
    window.SITE.contact.phone = phone;
    window.SITE.contact.phoneDisplay = phone;
    window.SITE.contact.sms = phone;
    window.SITE.contact.whatsapp = phone.replace(/\D/g, '') || "919888626786";
  }

  if (location) {
    const cityName = location.split(',')[0].trim();
    window.SITE.market.city = cityName;
    window.SITE.market.metro = location;
    window.SITE.contact.address.line1 = location;
    window.SITE.contact.address.street = location;
  }

  // 3. Dynamic Property Injection & Hero Polish on DOM Ready
  function onReady() {
    // Add page transition class
    document.body.classList.add('page-transitioning');

    // Create top progress bar
    if (!document.getElementById('pageProgress')) {
      const prog = document.createElement('div');
      prog.id = 'pageProgress';
      document.body.appendChild(prog);
      requestAnimationFrame(() => {
        prog.style.width = '100%';
        setTimeout(() => {
          prog.style.opacity = '0';
          setTimeout(() => prog.remove(), 300);
        }, 250);
      });
    }

    // Update hero on home page ONLY (do not touch sell.html, services.html, about.html, etc.)
    const isHomePage = window.location.pathname.endsWith('index.html') || 
                       window.location.pathname.endsWith('/real-estate-template/') || 
                       window.location.pathname.endsWith('/real-estate-template') ||
                       window.location.pathname === '/';
    if (projectTitle && isHomePage) {
      const heroH1 = document.querySelector('.hero__copy h1');
      if (heroH1) {
        heroH1.innerHTML = `The New Benchmark of Luxury at <em>${projectTitle}</em>`;
      }
      const eyebrow = document.querySelector('.hero__copy .eyebrow');
      if (eyebrow) {
        eyebrow.textContent = `${companyName || 'Nobogent'} • Signature Collection`;
      }
      const heroSub = document.querySelector('.hero__copy .hero__sub');
      if (heroSub) {
        heroSub.textContent = `Ultra-luxury residences in ${location || 'Prime Location'}. Starting at ${projectPrice || 'Special Launch Price'}. Schedule your private VIP preview and download the official brochure on WhatsApp.`;
      }
      const badgeTitle = document.querySelector('.hero__badge .t');
      if (badgeTitle) badgeTitle.textContent = projectTitle;
      const badgeSub = document.querySelector('.hero__badge .s');
      if (badgeSub) badgeSub.textContent = location || 'Prime Sector';
      const badgePrice = document.querySelector('.hero__badge .price');
      if (badgePrice) badgePrice.textContent = projectPrice || '₹1.85 Cr';

      document.title = `${projectTitle} | Luxury Real Estate by ${companyName || 'Nobogent'}`;
    }

    if (heroImage && heroImage.startsWith('http')) {
      const heroImgEl = document.querySelector('.hero__frame img');
      if (heroImgEl) {
        heroImgEl.src = heroImage;
        heroImgEl.srcset = '';
      }
    }

    // In DATA.properties, set property 0 as user's project
    if (window.DATA && window.DATA.properties && window.DATA.properties[0]) {
      const p0 = window.DATA.properties[0];
      if (projectTitle) p0.title = projectTitle;
      if (location) {
        p0.address = location;
        p0.city = location.split(',')[0].trim();
      }
      if (projectPrice) p0.displayPrice = projectPrice;
      if (heroImage) {
        p0.images = [heroImage, ...p0.images.filter(img => img !== heroImage)];
      }
    }

    // 4. Smooth Page Change Transitions across all internal links
    document.addEventListener('click', function (e) {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // Skip external links, hashes, javascript:, mailto:, tel:
      if (
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:') ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      ) {
        return;
      }

      // Check if it's an internal html link
      if (href.endsWith('.html') || (!href.includes('://') && !href.startsWith('//'))) {
        e.preventDefault();

        // Create or reset progress bar
        let prog = document.getElementById('pageProgress');
        if (!prog) {
          prog = document.createElement('div');
          prog.id = 'pageProgress';
          document.body.appendChild(prog);
        }
        prog.style.opacity = '1';
        prog.style.width = '85%';

        // Play page exit animation
        document.body.classList.remove('page-transitioning');
        document.body.classList.add('page-leaving');

        // Preserve branding query params on target URL
        let targetUrl = href;
        const currentQuery = window.location.search;
        if (currentQuery && !targetUrl.includes('?')) {
          targetUrl += currentQuery;
        }

        setTimeout(() => {
          window.location.href = targetUrl;
        }, 200);
      }
    });

    // Handle bfcache (Back/Forward navigation)
    window.addEventListener('pageshow', function (evt) {
      document.body.classList.remove('page-leaving');
      document.body.classList.add('page-transitioning');
      const prog = document.getElementById('pageProgress');
      if (prog) prog.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();

