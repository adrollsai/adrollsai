const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

async function buildComparison() {
  const logoPath = path.join(__dirname, '../public/nobogent-logo.png');
  const logoBuf = await sharp(logoPath)
    .resize(200, 200, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ quality: 95, compressionLevel: 9 })
    .toBuffer();
  const logoDataUri = 'data:image/png;base64,' + logoBuf.toString('base64');

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Nobogent AI - Commercial Comparison & Value Analysis</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');

  @page {
    size: A4 portrait;
    margin: 10mm 12mm 10mm 12mm;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1e293b;
    background: #ffffff;
    font-size: 10.5px;
    line-height: 1.4;
    zoom: 0.94;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .container {
    width: 100%;
    max-width: 100%;
  }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 10px;
    border-bottom: 2px solid #0f172a;
    margin-bottom: 12px;
  }

  .brand-col {
    display: flex;
    flex-direction: column;
  }

  .brand-header-flex {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }

  .brand-logo {
    width: 44px;
    height: 44px;
    object-fit: contain;
    border-radius: 6px;
  }

  .brand-col h1 {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #0f172a;
    line-height: 1.1;
  }

  .brand-col h1 span {
    color: #4f46e5;
  }

  .brand-subtitle {
    font-size: 9.5px;
    color: #64748b;
    font-weight: 600;
  }

  .quote-col {
    text-align: right;
  }

  .quote-badge {
    display: inline-block;
    background: #ecfdf5;
    color: #065f46;
    font-size: 9px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px 9px;
    border-radius: 999px;
    margin-bottom: 4px;
    border: 1px solid #a7f3d0;
  }

  .quote-title {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
  }

  .quote-meta {
    font-size: 9px;
    color: #64748b;
    margin-top: 2px;
  }

  /* Executive Callout Alert */
  .alert-banner {
    background: linear-gradient(135deg, #f0fdf4 0%, #e0f2fe 100%);
    border: 1px solid #bbf7d0;
    border-radius: 7px;
    padding: 9px 12px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .alert-banner-text h3 {
    font-size: 11.5px;
    font-weight: 800;
    color: #0f172a;
    margin-bottom: 2px;
  }

  .alert-banner-text p {
    font-size: 9.5px;
    color: #334155;
    line-height: 1.35;
  }

  .alert-stat {
    text-align: right;
    padding-left: 14px;
    border-left: 1px solid #cbd5e1;
  }

  .alert-stat .stat-num {
    font-size: 18px;
    font-weight: 800;
    color: #059669;
    line-height: 1;
  }

  .alert-stat .stat-label {
    font-size: 8.5px;
    color: #64748b;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Section Title */
  .section-title {
    font-size: 11px;
    font-weight: 800;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .section-title::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 12px;
    background: #4f46e5;
    border-radius: 2px;
  }

  /* Rate Conversion Table */
  table.comp-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 9.5px;
  }

  table.comp-table th {
    background: #0f172a;
    color: #ffffff;
    font-weight: 700;
    text-align: left;
    padding: 6px 9px;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  table.comp-table td {
    padding: 6px 9px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: middle;
  }

  table.comp-table tr:nth-child(even) td {
    background: #f8fafc;
  }

  .highlight-row {
    background: #eff6ff !important;
    font-weight: 700;
  }

  .highlight-row td {
    border-top: 1.5px solid #6366f1;
    border-bottom: 1.5px solid #6366f1;
  }

  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .bold { font-weight: 700; }
  .green-tag {
    color: #059669;
    font-weight: 800;
  }
  .red-strike {
    color: #dc2626;
    font-weight: 700;
  }

  /* 2-Column Comparison Cards */
  .cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }

  .cost-card {
    border-radius: 7px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    overflow: hidden;
  }

  .cost-card.competitor {
    border-color: #fca5a5;
  }

  .cost-card.nobogent {
    border-color: #86efac;
    box-shadow: 0 2px 4px rgba(16, 185, 129, 0.08);
  }

  .card-header {
    padding: 7px 11px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .cost-card.competitor .card-header {
    background: #fee2e2;
    color: #991b1b;
  }

  .cost-card.nobogent .card-header {
    background: #dcfce7;
    color: #14532d;
  }

  .card-body {
    padding: 8px 11px;
    font-size: 9.5px;
  }

  .cost-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px dashed #e2e8f0;
    color: #334155;
  }

  .cost-row:last-child {
    border-bottom: none;
  }

  .cost-row.card-total {
    border-top: 1.5px solid #0f172a;
    border-bottom: none;
    padding-top: 6px;
    margin-top: 4px;
    font-weight: 800;
    font-size: 11px;
  }

  .cost-card.competitor .card-total span:last-child {
    color: #b91c1c;
  }

  .cost-card.nobogent .card-total span:last-child {
    color: #059669;
  }

  /* Architectural Feature Comparison Grid */
  .features-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 9px;
  }

  .features-table th {
    background: #f1f5f9;
    color: #334155;
    font-weight: 800;
    text-align: left;
    padding: 5px 8px;
    border-bottom: 2px solid #cbd5e1;
    font-size: 8.5px;
    text-transform: uppercase;
  }

  .features-table td {
    padding: 5px 8px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: middle;
  }

  .features-table tr:nth-child(even) td {
    background: #f8fafc;
  }

  .tag-yes {
    display: inline-block;
    background: #dcfce7;
    color: #15803d;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 8px;
  }

  .tag-no {
    display: inline-block;
    background: #fee2e2;
    color: #b91c1c;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 8px;
  }

  /* Bottom Conclusion Callout */
  .conclusion-box {
    background: #0f172a;
    color: #ffffff;
    border-radius: 7px;
    padding: 9px 13px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .conclusion-text h4 {
    font-size: 11px;
    font-weight: 800;
    color: #38bdf8;
    margin-bottom: 2px;
  }

  .conclusion-text p {
    font-size: 9px;
    color: #cbd5e1;
    line-height: 1.35;
  }

  .conclusion-contact {
    text-align: right;
    font-size: 9px;
    color: #94a3b8;
    line-height: 1.4;
    padding-left: 14px;
    border-left: 1px solid #334155;
  }

  .conclusion-contact strong {
    color: #ffffff;
  }
</style>
</head>
<body>

<div class="container">
  <!-- Header -->
  <div class="header">
    <div class="brand-col">
      <div class="brand-header-flex">
        <img src="${logoDataUri}" alt="Nobogent Logo" class="brand-logo" />
        <div>
          <h1>NOBO<span>GENT</span> AI</h1>
          <div class="brand-subtitle">Enterprise Real Estate Voice Infrastructure | Commercial Analysis</div>
        </div>
      </div>
    </div>
    <div class="quote-col">
      <div class="quote-badge">Commercial Clarity Document</div>
      <div class="quote-title">RATE & VALUE COMPARISON</div>
      <div class="quote-meta">
        <strong>Prepared For:</strong> Prospective Real Estate Partner<br>
        <strong>Reference Quotation:</strong> NBG-QUO-2026-1042
      </div>
    </div>
  </div>

  <!-- Key Revelation Alert -->
  <div class="alert-banner">
    <div class="alert-banner-text">
      <h3>The Reality of "Per Second" vs. "Per Minute" Pricing</h3>
      <p>
        Vendors often present pricing in <strong>paise per second</strong> (e.g. ₹0.12/sec) because it appears visually small.<br>
        When converted to standard industry calling minutes (× 60 seconds), <strong>₹0.12/sec equals ₹7.20/minute</strong> — making Nobogent <strong>41.7% more affordable</strong> while including telecom & infrastructure setup.
      </p>
    </div>
    <div class="alert-stat">
      <div class="stat-num">₹30,000+</div>
      <div class="stat-label">Direct Minute Savings</div>
    </div>
  </div>

  <!-- Section 1: Rate Normalization Table -->
  <div class="section-title">Volume Tier Rate Conversion: Vendor Quotation vs. Nobogent</div>
  <table class="comp-table">
    <thead>
      <tr>
        <th style="width: 25%;">Monthly Volume Tier</th>
        <th style="width: 20%;" class="text-center">Other Vendor Quoted Rate</th>
        <th style="width: 20%;" class="text-right">Other Vendor (Per Min)</th>
        <th style="width: 20%;" class="text-right">Nobogent All-Inclusive</th>
        <th style="width: 15%;" class="text-center">Your Direct Saving</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="bold">5,000 Minutes Tier</td>
        <td class="text-center red-strike">₹0.150 / sec</td>
        <td class="text-right red-strike">₹9.00 / min</td>
        <td class="text-right bold green-tag">₹4.20 / min</td>
        <td class="text-center bold green-tag">53.3% Cheaper</td>
      </tr>
      <tr class="highlight-row">
        <td class="bold">5,000 – 10,000 Minutes Tier (Your Scope)</td>
        <td class="text-center red-strike">₹0.120 / sec</td>
        <td class="text-right red-strike">₹7.20 / min</td>
        <td class="text-right bold green-tag">₹4.20 / min</td>
        <td class="text-center bold green-tag">41.7% Cheaper</td>
      </tr>
      <tr>
        <td class="bold">10,000 – 20,000 Minutes Tier</td>
        <td class="text-center red-strike">₹0.110 / sec</td>
        <td class="text-right red-strike">₹6.60 / min</td>
        <td class="text-right bold green-tag">₹4.20 / min</td>
        <td class="text-center bold green-tag">36.4% Cheaper</td>
      </tr>
      <tr>
        <td class="bold">Above 20,000 Minutes Tier</td>
        <td class="text-center red-strike">₹0.095 / sec</td>
        <td class="text-right red-strike">₹5.70 / min</td>
        <td class="text-right bold green-tag">₹4.20 / min</td>
        <td class="text-center bold green-tag">26.3% Cheaper</td>
      </tr>
    </tbody>
  </table>

  <!-- Section 2: Financial Case Study (10,000 Minutes Pack) -->
  <div class="section-title">Head-to-Head Commercial Impact (10,000 Minutes Deployment)</div>
  <div class="cards-grid">
    <!-- Competitor Card -->
    <div class="cost-card competitor">
      <div class="card-header">
        <span>Other Vendor Quotation</span>
        <span>Hidden Overheads</span>
      </div>
      <div class="card-body">
        <div class="cost-row">
          <span>10,000 Calling Minutes (@ ₹0.12 / sec = ₹7.20 / min)</span>
          <span class="bold">₹72,000.00</span>
        </div>
        <div class="cost-row">
          <span>Platform Setup, Calibration & Workflow Integration</span>
          <span class="bold">₹15,000 – ₹20,000</span>
        </div>
        <div class="cost-row">
          <span>Dedicated Business Number (+91 DID Provisioning)</span>
          <span class="bold">₹2,000.00</span>
        </div>
        <div class="cost-row">
          <span>Unconnected Dials (Failed / Busy Surcharges)</span>
          <span class="bold">Billed Separately</span>
        </div>
        <div class="cost-row card-total">
          <span>ESTIMATED PAYABLE OUTLAY</span>
          <span>₹89,000.00+</span>
        </div>
      </div>
    </div>

    <!-- Nobogent Card -->
    <div class="cost-card nobogent">
      <div class="card-header">
        <span>Nobogent Enterprise Proposal</span>
        <span>All-Inclusive Value</span>
      </div>
      <div class="card-body">
        <div class="cost-row">
          <span>10,000 Calling Minutes (@ ₹4.20 / min all-inclusive)</span>
          <span class="bold">₹42,000.00</span>
        </div>
        <div class="cost-row">
          <span>5 High-Speed Concurrency Channels (₹500 &times; 5)</span>
          <span class="bold">₹2,500.00</span>
        </div>
        <div class="cost-row">
          <span>Enterprise Setup & Script Tuning (₹20,000 Value)</span>
          <span class="bold green-tag">WAIVED OFF (₹0.00)</span>
        </div>
        <div class="cost-row">
          <span>Dedicated Virtual Business DID (+91 Masking)</span>
          <span class="bold green-tag">WAIVED OFF (₹0.00)</span>
        </div>
        <div class="cost-row card-total">
          <span>TOTAL TAXABLE PROPOSAL</span>
          <span>₹44,500.00</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Section 3: Value Deliverables Comparison -->
  <div class="section-title">Contractual & Technical Safeguards Comparison</div>
  <table class="features-table">
    <thead>
      <tr>
        <th style="width: 32%;">Capability / Contract Term</th>
        <th style="width: 34%;">Other Vendor Model</th>
        <th style="width: 34%;">Nobogent Enterprise Model</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="bold">Rate Transparency</td>
        <td>Billed in seconds (₹0.12/sec) masking higher minute cost</td>
        <td><span class="tag-yes">Transparent</span> Blended ₹4.20/min (Telecom ₹1.00 base + AI ₹0.06/sec)</td>
      </tr>
      <tr>
        <td class="bold">Minute Rollover Policy</td>
        <td><span class="tag-no">Expires</span> Unused monthly balance resets at 30 days</td>
        <td><span class="tag-yes">Guaranteed</span> 90-day minute carry-forward validity</td>
      </tr>
      <tr>
        <td class="bold">Failed / Busy Dial Penalties</td>
        <td><span class="tag-no">Charged</span> Attempt fees for unanswered/busy dials</td>
        <td><span class="tag-yes">100% Free</span> Unlimited unconnected attempt surcharges waived</td>
      </tr>
      <tr>
        <td class="bold">Dialing Concurrency</td>
        <td>Single or shared channel (congested queue clearing)</td>
        <td><span class="tag-yes">5 Dedicated Channels</span> High-throughput 800+ leads cleared daily</td>
      </tr>
      <tr>
        <td class="bold">Lead Intelligence & CRM</td>
        <td>Basic audio recording only</td>
        <td><span class="tag-yes">Deep CRM Sync</span> Dual recording + HOT/WARM qualification notes</td>
      </tr>
    </tbody>
  </table>

  <!-- Bottom Executive Summary -->
  <div class="conclusion-box">
    <div class="conclusion-text">
      <h4>Summary Recommendation for Your Decision</h4>
      <p>
        At 10,000 minutes, Nobogent provides an immediate <strong>direct cash saving of ₹44,500+</strong> (over 50% lower total outlay), eliminates all setup risks, protects your minutes with a 90-day rollover guarantee, and provides high-speed 5-channel concurrency.
      </p>
    </div>
    <div class="conclusion-contact">
      <strong>Nobogent AI Solutions LLP</strong><br>
      Web: app.nobogent.com<br>
      Email: info@nobogent.com
    </div>
  </div>
</div>

</body>
</html>
`;

  const htmlPath = path.join(__dirname, '../Nobogent_Vendor_Comparison.html');
  const pdfPath = path.join(__dirname, '../Nobogent_Vendor_Comparison.pdf');

  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log('Saved Comparison HTML to:', htmlPath);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeCmd = `"${chromePath}" --headless --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`;
  console.log('Generating Comparison PDF via Chrome...');
  execSync(chromeCmd);
  console.log('Comparison PDF successfully generated at:', pdfPath);
}

buildComparison().catch(err => {
  console.error(err);
  process.exit(1);
});
