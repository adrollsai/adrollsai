const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');

async function buildQuotation() {
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
<title>Nobogent AI - Enterprise AI Calling Quotation</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');

  @page {
    size: A4 portrait;
    margin: 12mm 14mm 12mm 14mm;
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
    font-size: 11px;
    line-height: 1.45;
    zoom: 0.95;
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
    padding-bottom: 12px;
    border-bottom: 2px solid #0f172a;
    margin-bottom: 14px;
  }

  .brand-col {
    display: flex;
    flex-direction: column;
  }

  .brand-header-flex {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
  }

  .brand-logo {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: 8px;
  }

  .brand-col h1 {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #0f172a;
    line-height: 1.1;
  }

  .brand-col h1 span {
    color: #4f46e5;
  }

  .brand-subtitle {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
    margin-top: 2px;
  }

  .company-meta {
    font-size: 9.5px;
    color: #475569;
    line-height: 1.45;
  }

  .quote-col {
    text-align: right;
  }

  .quote-badge {
    display: inline-block;
    background: #eef2ff;
    color: #4338ca;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px 10px;
    border-radius: 999px;
    margin-bottom: 5px;
    border: 1px solid #c7d2fe;
  }

  .quote-title {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: 0.2px;
  }

  .quote-meta {
    font-size: 9.5px;
    color: #64748b;
    margin-top: 4px;
    line-height: 1.4;
  }

  /* Client & Summary Grid */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 14px;
  }

  .info-block h3 {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #64748b;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .info-block p {
    font-size: 10.5px;
    color: #0f172a;
    line-height: 1.45;
  }

  .info-block p strong {
    font-weight: 700;
  }

  /* Section Title */
  .section-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #0f172a;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 7px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .section-title::before {
    content: '';
    display: inline-block;
    width: 4px;
    height: 13px;
    background: #4f46e5;
    border-radius: 2px;
  }

  /* Main Pricing Table */
  table.pricing-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 10px;
  }

  table.pricing-table th {
    background: #0f172a;
    color: #ffffff;
    font-weight: 700;
    text-align: left;
    padding: 7px 10px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  table.pricing-table td {
    padding: 7px 10px;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: middle;
  }

  table.pricing-table tr:nth-child(even) td {
    background: #f8fafc;
  }

  .badge-waived {
    display: inline-block;
    background: #ecfdf5;
    color: #065f46;
    border: 1px solid #a7f3d0;
    font-size: 8.5px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.4px;
  }

  .badge-included {
    display: inline-block;
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
    font-size: 8.5px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.4px;
  }

  .strike-price {
    text-decoration: line-through;
    color: #94a3b8;
    margin-right: 5px;
  }

  .text-right {
    text-align: right;
  }

  .text-center {
    text-align: center;
  }

  .bold {
    font-weight: 700;
  }

  /* Total Summary Box */
  .totals-wrapper {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 14px;
  }

  .totals-box {
    width: 50%;
    border: 1px solid #e2e8f0;
    border-radius: 7px;
    background: #ffffff;
    overflow: hidden;
  }

  .totals-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 11px;
    font-size: 10px;
    border-bottom: 1px solid #f1f5f9;
  }

  .totals-row.savings {
    background: #f0fdf4;
    color: #166534;
    font-weight: 700;
  }

  .totals-row.grand-total {
    background: #0f172a;
    color: #ffffff;
    font-weight: 800;
    font-size: 12px;
    padding: 8px 11px;
    border-bottom: none;
  }

  .totals-row.grand-total span:last-child {
    color: #38bdf8;
  }

  /* Included Architecture / Value Adds Grid */
  .features-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 9px;
    margin-bottom: 14px;
  }

  .feature-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  .feature-icon {
    width: 17px;
    height: 17px;
    background: #e0e7ff;
    color: #4338ca;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9.5px;
    font-weight: 800;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .feature-content h4 {
    font-size: 9.5px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 2px;
  }

  .feature-content p {
    font-size: 8.5px;
    color: #64748b;
    line-height: 1.35;
  }

  /* Terms and Bank Details */
  .footer-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 12px;
    padding-top: 10px;
    border-top: 1px solid #e2e8f0;
  }

  .terms-box h4, .bank-box h4 {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 5px;
  }

  .terms-list {
    list-style: disc;
    padding-left: 14px;
    font-size: 9px;
    color: #475569;
    line-height: 1.45;
  }

  .bank-details {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 9.5px;
    color: #1e293b;
    line-height: 1.55;
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
          <div class="brand-subtitle">Autonomous Real Estate Voice & Marketing Infrastructure</div>
        </div>
      </div>
      <div class="company-meta">
        <strong>Nobogent AI Solutions LLP</strong><br>
        SCO - 3, Riverdale Business Center, First Floor, Cabin no.2, Zirakpur, Punjab 140603<br>
        <strong>GSTIN:</strong> 03ABAFN4520F1ZW &nbsp;|&nbsp; <strong>Email:</strong> info@nobogent.com &nbsp;|&nbsp; <strong>Web:</strong> app.nobogent.com
      </div>
    </div>
    <div class="quote-col">
      <div class="quote-badge">Official Commercial Quotation</div>
      <div class="quote-title">ENTERPRISE AI CALLING</div>
      <div class="quote-meta">
        <strong>Quotation #:</strong> NBG-QUO-2026-1042<br>
        <strong>Date:</strong> October 13, 2026<br>
        <strong>Valid Until:</strong> October 28, 2026 (15 Days)<br>
        <strong>Prepared For:</strong> Enterprise Volume Client
      </div>
    </div>
  </div>

  <!-- Client & Project Scope -->
  <div class="info-grid">
    <div class="info-block">
      <h3>Client Account Details</h3>
      <p>
        <strong>Client Name:</strong> Prospective Real Estate Partner<br>
        <strong>Engagement Type:</strong> Dedicated Outbound AI Voice Calling<br>
        <strong>Commitment Volume:</strong> 5,000 Dials / Week (~20,000 Dials / Month)
      </p>
    </div>
    <div class="info-block">
      <h3>Infrastructure Deployment Scope</h3>
      <p>
        <strong>Voice AI Pipeline:</strong> Ultra-Low Latency Conversational Voice AI (Full Duplex)<br>
        <strong>Carrier Route:</strong> Dedicated Indian Virtual Trunk (+91 DID Pool)<br>
        <strong>Concurrency:</strong> 5 Dedicated Parallel Dialing Channels
      </p>
    </div>
  </div>

  <!-- Pricing Table -->
  <div class="section-title">Investment & Commercial Proposal</div>
  <table class="pricing-table">
    <thead>
      <tr>
        <th style="width: 44%;">Service Item & Specification</th>
        <th class="text-center" style="width: 12%;">Quantity</th>
        <th class="text-right" style="width: 14%;">Standard Rate</th>
        <th class="text-right" style="width: 14%;">Offered Rate</th>
        <th class="text-right" style="width: 16%;">Amount (INR)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div class="bold">Connected AI Voice Calling Minutes</div>
          <div style="font-size: 8.5px; color: #64748b;">Rate: Telecom carrier route (min ₹1.00/call) + Voice AI dialogue (₹0.06/sec ≈ ₹3.60/min) | CRM sync</div>
        </td>
        <td class="text-center bold">10,000 Mins</td>
        <td class="text-right strike-price">₹5.00 / min</td>
        <td class="text-right bold" style="color: #4f46e5;">₹4.20 / min</td>
        <td class="text-right bold">₹42,000.00</td>
      </tr>
      <tr>
        <td>
          <div class="bold">Dedicated Dialing Channels (Concurrent Lines)</div>
          <div style="font-size: 8.5px; color: #64748b;">Enables up to 5 parallel simultaneous outbound calls (high-speed list clearance)</div>
        </td>
        <td class="text-center bold">5 Channels</td>
        <td class="text-right">₹500.00 / ch</td>
        <td class="text-right bold">₹500.00 / ch</td>
        <td class="text-right bold">₹2,500.00</td>
      </tr>
      <tr>
        <td>
          <div class="bold">One-Time Enterprise AI Setup & Infrastructure Deployment Charges</div>
          <div style="font-size: 8.5px; color: #64748b;">Custom real estate prompt/persona calibration, zero-latency greeting pipeline & CRM workflow integration</div>
        </td>
        <td class="text-center">1 Deployment</td>
        <td class="text-right strike-price">₹20,000.00</td>
        <td class="text-right"><span class="badge-waived">WAIVED OFF</span></td>
        <td class="text-right bold" style="color: #059669;">₹0.00</td>
      </tr>
      <tr>
        <td>
          <div class="bold">Dedicated Virtual 10-Digit Business Phone Number (+91 DID)</div>
          <div style="font-size: 8.5px; color: #64748b;">Carrier verification, CLI masking, and telecom regulatory compliance</div>
        </td>
        <td class="text-center">1 Number</td>
        <td class="text-right strike-price">₹2,000.00</td>
        <td class="text-right"><span class="badge-waived">WAIVED OFF</span></td>
        <td class="text-right bold" style="color: #059669;">₹0.00</td>
      </tr>
      <tr>
        <td>
          <div class="bold">Unconnected Call Surcharge (Busy / No Answer / Failed)</div>
          <div style="font-size: 8.5px; color: #64748b;">Carrier dial attempt surcharges waived across all 20,000+ monthly dialed leads</div>
        </td>
        <td class="text-center">Unlimited</td>
        <td class="text-right strike-price">₹0.10 / dial</td>
        <td class="text-right"><span class="badge-waived">WAIVED OFF</span></td>
        <td class="text-right bold" style="color: #059669;">₹0.00</td>
      </tr>
    </tbody>
  </table>

  <!-- Totals Box -->
  <div class="totals-wrapper">
    <div class="totals-box">
      <div class="totals-row">
        <span>Calling Minutes Pack (10,000 Mins @ ₹4.20)</span>
        <span class="bold">₹42,000.00</span>
      </div>
      <div class="totals-row">
        <span>5 Concurrent Channels (₹500 &times; 5)</span>
        <span class="bold">₹2,500.00</span>
      </div>
      <div class="totals-row">
        <span>Net Taxable Subtotal</span>
        <span class="bold">₹44,500.00</span>
      </div>
      <div class="totals-row savings">
        <span>Total Promotional Savings & Fee Waivers</span>
        <span class="bold">-₹30,000.00</span>
      </div>
      <div class="totals-row">
        <span>Applicable GST (18%)</span>
        <span class="bold">₹8,010.00</span>
      </div>
      <div class="totals-row grand-total">
        <span>TOTAL PAYABLE AMOUNT</span>
        <span>₹52,510.00</span>
      </div>
    </div>
  </div>

  <!-- Included Enterprise Features (Auto WhatsApp removed) -->
  <div class="section-title">Enterprise Infrastructure Capabilities Included</div>
  <div class="features-grid">
    <div class="feature-card">
      <div class="feature-icon">✓</div>
      <div class="feature-content">
        <h4>Dual-Layer Recording & 90-Day Retention</h4>
        <p>Every conversation is recorded in high quality and permanently stored in your private dashboard for auditing.</p>
      </div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">✓</div>
      <div class="feature-content">
        <h4>Automated AI Lead Qualification & CRM Sync</h4>
        <p>Intelligently extracts buyer budget, timeline, and interest level (HOT / WARM / COLD) directly into your CRM.</p>
      </div>
    </div>
    <div class="feature-card">
      <div class="feature-icon">✓</div>
      <div class="feature-content">
        <h4>Smart Calling Window & DNC Safeguards</h4>
        <p>Strict 9:00 AM – 7:00 PM IST compliance engine automatically reschedules off-hour leads to the next business morning.</p>
      </div>
    </div>
  </div>

  <!-- Terms & Verified Bank Details -->
  <div class="footer-grid">
    <div class="terms-box">
      <h4>Commercial Terms & Conditions</h4>
      <ul class="terms-list">
        <li><strong>Minute Consumption & Rate Composition:</strong> Minutes deducted for answered calls only at ₹4.20/min (comprising ₹1.00 telecom carrier base per connected call + ₹0.06/sec AI voice engine).</li>
        <li><strong>Rollover Guarantee:</strong> Unused minutes from this 10,000-minute pack carry forward for up to 90 days.</li>
        <li><strong>Overage Rate:</strong> Additional calling minutes beyond 10,000 are billed at the locked enterprise rate of <strong>₹4.20 + GST / minute</strong>.</li>
        <li><strong>Deployment Timeline:</strong> Dedicated number provisioning and custom prompt calibration are activated within 24 hours of payment.</li>
      </ul>
    </div>
    <div class="bank-box">
      <h4>Payment & Bank Transfer Details</h4>
      <div class="bank-details">
        <strong>Beneficiary Name:</strong> NOBOGENT AI SOLUTIONS LLP<br>
        <strong>Bank:</strong> HDFC Bank Ltd.<br>
        <strong>Account Type:</strong> Current Account<br>
        <strong>Account Number:</strong> 50200124394882<br>
        <strong>IFSC Code:</strong> HDFC0011117
      </div>
    </div>
  </div>
</div>

</body>
</html>
`;

  const htmlPath = path.join(__dirname, '../Nobogent_Enterprise_AI_Calling_Quotation.html');
  const pdfPath = path.join(__dirname, '../Nobogent_Enterprise_AI_Calling_Quotation.pdf');

  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  console.log('Saved HTML to:', htmlPath);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const chromeCmd = `"${chromePath}" --headless --no-pdf-header-footer --print-to-pdf="${pdfPath}" "${htmlPath}"`;
  console.log('Generating PDF via Chrome...');
  execSync(chromeCmd);
  console.log('PDF successfully generated at:', pdfPath);
}

buildQuotation().catch(err => {
  console.error(err);
  process.exit(1);
});
