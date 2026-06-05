'use client'

import React, { useState } from 'react'

export default function NextLandingPage() {
  // Contact Form State
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [project, setProject] = useState('')
  const [role, setRole] = useState('')
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    // Combine extra fields into message to comply with the existing contact API schema
    const combinedMessage = `Project Location/City: ${project} | Role: ${role}`

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          message: combinedMessage
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit request.')
      }

      setSubmitSuccess(true)
      setName('')
      setPhone('')
      setEmail('')
      setProject('')
      setRole('')
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="landing-body">
      {/* Alert Banner */}
      <div className="alert-banner">
        <span>🚨 <strong>CRITICAL WARNING FOR BUILDERS & BROKERS:</strong> Most agencies throw away 70% of your budget on fake numbers and junk lead forms. Stop it now.</span>
      </div>

      {/* Header */}
      <header className="main-header">
        <div className="container header-container">
          <div className="logo">
            <span className="logo-red">Ad</span><span className="logo-blue">Rolls</span>
            <span className="logo-sub">AI LEAD MACHINE</span>
          </div>
          <a href="#qualification-form" className="cta-header">Request Invites »</a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="container">
          <div className="badge-warning">REAL ESTATE DEVELOPERS, BUILDERS & BROKERS:</div>
          
          <h1 className="hero-title">
            Are You Sick & Tired of Wasting Lakhs on <span className="highlight-yellow">Junk Leads</span> That Don't Even Answer Your Phone?
          </h1>

          <p className="hero-subtitle">
            Stop calling fake numbers. AdRolls automatically qualifies property buyers, verifies their WhatsApp numbers via OTP, and targets high-intent investors directly using Meta Server-Side API (CAPI) on Autopilot.
          </p>

          {/* Trust Elements / Checkmarks */}
          <div className="hero-features">
            <div className="feature-item">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="icon-check"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span><strong>Zero Tech Setup</strong> Required</span>
            </div>
            <div className="feature-item">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" strokeLinecap="round" strokeLinejoin="round" className="icon-check"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span><strong>100% Pre-Verified</strong> WhatsApp Numbers</span>
            </div>
            <div className="feature-item">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" strokeLinecap="round" strokeLinejoin="round" className="icon-check"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span><strong>Direct Meta CAPI</strong> Pixel Sync</span>
            </div>
          </div>

          {/* Form Card */}
          <div className="form-card" id="qualification-form">
            <div className="form-header">
              <h2>CLAIM YOUR FREE 15-MINUTE LEAD FLOW AUDIT</h2>
              <p>We'll show you exactly how many junk leads you're currently paying for—and how to fix it in 5 days.</p>
            </div>

            {submitSuccess ? (
              <div className="success-message">
                🎉 <strong>Thank you!</strong> Our Lead Flow Specialist will call you within 15 minutes to initiate your free audit.
              </div>
            ) : (
              <form onSubmit={handleContactSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="name">Your Name</label>
                    <input 
                      type="text" 
                      id="name" 
                      required 
                      placeholder="e.g. Ritesh Sharma" 
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="phone">WhatsApp Number</label>
                    <input 
                      type="tel" 
                      id="phone" 
                      required 
                      placeholder="e.g. 9876543210" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="email">Business Email</label>
                    <input 
                      type="email" 
                      id="email" 
                      required 
                      placeholder="ritesh@companyname.com" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="project">Active Project / City</label>
                    <input 
                      type="text" 
                      id="project" 
                      required 
                      placeholder="e.g. Mohali, Zirakpur, Gurgaon" 
                      value={project}
                      onChange={(e) => setProject(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="role">Your Professional Role</label>
                  <select 
                    id="role" 
                    required
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="">-- Select your role --</option>
                    <option value="Builder / Developer">Real Estate Builder / Developer</option>
                    <option value="Broker / Channel Partner">Broker / Channel Partner</option>
                    <option value="Marketing Head">Head of Marketing / Agency</option>
                  </select>
                </div>

                {submitError && <p className="error-text">❌ {submitError}</p>}

                <button type="submit" disabled={isSubmitting} className="submit-btn animate-pulse">
                  {isSubmitting ? 'PROCESSING...' : 'CLAIM MY FREE AUDIT & INVITE NOW »'}
                </button>
              </form>
            )}

            <div className="form-guarantee">
              🔒 <strong>Double Guarantee:</strong> No cost, no obligation, and zero spam. We value your privacy.
            </div>
          </div>
        </div>
      </section>

      {/* Clients / Social Proof */}
      <section className="clients-section">
        <div className="container">
          <h2 className="section-tag">PROVEN BY TOP BRANDS IN NORTH INDIA</h2>
          <p className="clients-desc">We build pre-qualified lead pipelines for leading real estate developers and brokers:</p>
          
          <div className="clients-grid">
            <span className="client-name">Blue Square Infra</span>
            <span className="client-name">HOMCOM Realtors</span>
            <span className="client-name">GNR Homes</span>
            <span className="client-name">Realty Nation Mohali</span>
            <span className="client-name">Medallion Group</span>
            <span className="client-name">Green Lotus</span>
            <span className="client-name">Escon Primera</span>
            <span className="client-name italic-more">and many more</span>
          </div>
        </div>
      </section>

      {/* Pain vs Solution Section */}
      <section className="value-section">
        <div className="container">
          <h2 className="value-h2-big">The Cruel Truth: Why Standard Facebook Ads Are Burning Your Lakhs (And How We Force Verification)</h2>
          
          <div className="grid-two">
            {/* Pain Card */}
            <div className="pain-card">
              <div className="card-icon bg-red-light text-red">❌</div>
              <h3>Standard Facebook Lead Ads</h3>
              <ul className="bullet-list text-slate">
                <li><strong>Fake Mobile Numbers:</strong> Users fill lead forms with pre-filled, outdated, or dummy mobile numbers.</li>
                <li><strong>Mistaken Clicks:</strong> Fast scrolling leads to accidental clicks. People submit forms without knowing what they clicked.</li>
                <li><strong>Cookie Blockers:</strong> Apple iOS 14+ blocks your Meta Pixel from knowing which leads are actually buyers.</li>
                <li><strong>Cold Calling Nightmares:</strong> Sales teams waste 80% of their day dialing switched-off phones and hearing "I didn't submit any form".</li>
              </ul>
            </div>

            {/* Solution Card */}
            <div className="solution-card">
              <div className="card-icon bg-green-light text-green">✔</div>
              <h3>The AdRolls AI Lead System</h3>
              <ul className="bullet-list">
                <li><strong>Mandatory WhatsApp Verification:</strong> Buyers must input an active, verified mobile number before submitting the form.</li>
                <li><strong>No Accidental Forms:</strong> Custom high-converting landing pages ensure only people who read your offer submit details.</li>
                <li><strong>Meta Conversions API (CAPI):</strong> Server-side tracking bypasses browser blockers and tracks offline visits/bookings.</li>
                <li><strong>Hot, Pre-Qualified Calls:</strong> Your sales team only calls verified property buyers who are actively waiting for details.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="steps-section">
        <div className="container text-center">
          <h2 className="value-h2-big">From Setup to Pre-Qualified Property Buyers in 3 Simple Steps</h2>
          <p className="steps-sub">We remove the effort. You focus on site visits and closing deals.</p>

          <div className="grid-three">
            {/* Step 1 */}
            <div className="step-card">
              <div className="step-num">1</div>
              <h3>Auto-Generate Pages</h3>
              <p>Our agentic AI instantly spins up custom landing pages tailored specifically for your project (e.g. 3 BHK, Luxury Villas, Plots) with premium real-estate copy and floor plans.</p>
            </div>

            {/* Step 2 */}
            <div className="step-card">
              <div className="step-num">2</div>
              <h3>Filter Junk Leads</h3>
              <p>Our platform forces visitors to complete qualification questions (e.g. Budget, Buying Timeline) and verifies their WhatsApp number. Fake profiles are filtered out instantly.</p>
            </div>

            {/* Step 3 */}
            <div className="step-card">
              <div className="step-num">3</div>
              <h3>Train Meta Algorithm</h3>
              <p>We push verified buyer events back to Meta using server-to-server CAPI. This forces Facebook to stop targeting casual scroll-wasters and optimize for real buyers.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial Section */}
      <section className="testimonial-section">
        <div className="container text-center">
          <h2 className="value-h2-big">"Our site visits grew by 3.5X while call volume dropped in half."</h2>
          
          <div className="testimonial-box">
            <p className="testimonial-text">
              "Earlier, we were getting 50 leads a day but only 2 or 3 answered our calls. The rest were fake or duplicate numbers. After switching to AdRolls' verified landing pages, we get 15 leads, but 12 of them are genuine buyers. Our sales team is happy, and our conversion rate is sky-high."
            </p>
            <div className="testimonial-author">
              <strong>— Real Estate Marketing Director</strong>
              <span className="author-sub">Mohali Region Developer</span>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Block */}
      <section className="final-cta">
        <div className="container text-center">
          <h2 className="final-title">Stop Throwing Money Down the Toilet. Get Pre-Qualified Real Estate Leads Today.</h2>
          <p className="final-sub">No card details required. Schedule your lead audit and see the platform in action.</p>
          
          <a href="#qualification-form" className="big-cta-btn">
            REQUEST YOUR FREE LEAD FLOW AUDIT TODAY »
          </a>
          
          <div className="cta-subtext">
            Only taking 7 builders/brokers this week to maintain dedicated service.
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="main-footer">
        <div className="container">
          <p className="footer-logo">AdRolls AI</p>
          <p className="footer-address">Serving Builders and Brokers across Mohali, Zirakpur, Gurgaon, and Delhi NCR.</p>
          <p className="footer-copy">© {new Date().getFullYear()} AdRolls. All rights reserved. adrolls.in is a SaaS platform by AdRolls Technologies.</p>
        </div>
      </footer>

      {/* Mobile Sticky Footer */}
      <div className="mobile-sticky-footer">
        <a href="tel:+919872490091" className="sticky-btn tel-btn">📞 Call Sales</a>
        <a href="https://wa.me/919872490091?text=Hi,%20I'm%20interested%20in%20pre-qualified%20real%20estate%20leads%20from%20AdRolls." target="_blank" rel="noopener noreferrer" className="sticky-btn wa-btn">💬 WhatsApp Us</a>
      </div>

      {/* Scoped Stylesheet */}
      <style>{`
        .landing-body {
          font-family: 'Inter', sans-serif;
          color: #0B0F19;
          background-color: #FFFFFF;
          line-height: 1.5;
          margin: 0;
          padding: 0;
          padding-bottom: 70px;
        }

        .landing-body h1, .landing-body h2, .landing-body h3 {
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -0.02em;
        }

        .landing-body .container {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 20px;
        }

        .landing-body .alert-banner {
          background-color: #E11D48;
          color: #FFFFFF;
          text-align: center;
          padding: 12px 20px;
          font-size: 14px;
          font-weight: 600;
          border-bottom: 3px solid #0B0F19;
        }

        .landing-body .main-header {
          border-bottom: 3px solid #0B0F19;
          padding: 15px 0;
          background-color: #FFFFFF;
        }
        .landing-body .header-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .landing-body .logo {
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 28px;
          letter-spacing: -1px;
          display: flex;
          flex-direction: column;
          line-height: 0.9;
        }
        .landing-body .logo-red {
          color: #E11D48;
        }
        .landing-body .logo-blue {
          color: #0B0F19;
        }
        .landing-body .logo-sub {
          font-size: 9px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          letter-spacing: 2px;
          color: #4B5563;
          margin-top: 2px;
        }
        .landing-body .cta-header {
          background-color: #0B0F19;
          color: #FFFFFF;
          text-decoration: none;
          font-weight: 800;
          font-family: 'Space Grotesk', sans-serif;
          padding: 8px 16px;
          border-radius: 4px;
          border: 2px solid #0B0F19;
          font-size: 14px;
          transition: all 0.2s ease;
        }
        .landing-body .cta-header:hover {
          background-color: #FFFFFF;
          color: #0B0F19;
        }

        .landing-body .hero-section {
          background-color: #F3F4F6;
          padding: 60px 0 80px 0;
          border-bottom: 3px solid #0B0F19;
          text-align: center;
        }
        .landing-body .badge-warning {
          background-color: #E11D48;
          color: #FFFFFF;
          display: inline-block;
          padding: 6px 14px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: 14px;
          border: 2px solid #0B0F19;
          box-shadow: 2px 2px 0px #0B0F19;
          margin-bottom: 25px;
        }
        .landing-body .hero-title {
          font-size: 56px;
          margin-bottom: 25px;
          max-width: 950px;
          margin-left: auto;
          margin-right: auto;
          color: #0B0F19;
        }
        .landing-body .highlight-yellow {
          background-color: #FFDE00;
          padding: 2px 10px;
          border: 2px solid #0B0F19;
          box-shadow: 3px 3px 0px #0B0F19;
          display: inline-block;
        }
        .landing-body .hero-subtitle {
          font-size: 20px;
          color: #4B5563;
          max-width: 750px;
          margin: 0 auto 40px auto;
          font-weight: 600;
          line-height: 1.6;
        }
        .landing-body .hero-features {
          display: flex;
          justify-content: center;
          gap: 30px;
          flex-wrap: wrap;
          margin-bottom: 50px;
        }
        .landing-body .feature-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 16px;
          background-color: #FFFFFF;
          padding: 10px 18px;
          border: 2px solid #0B0F19;
          box-shadow: 3px 3px 0px #0B0F19;
          font-weight: 500;
        }
        .landing-body .icon-check {
          color: #10B981;
          flex-shrink: 0;
        }

        .landing-body .form-card {
          background-color: #FFFFFF;
          border: 3px solid #0B0F19;
          box-shadow: 8px 8px 0px #0B0F19;
          max-width: 650px;
          margin: 0 auto;
          padding: 40px;
          text-align: left;
          border-radius: 8px;
        }
        .landing-body .form-header {
          border-bottom: 2px dashed #4B5563;
          padding-bottom: 20px;
          margin-bottom: 25px;
        }
        .landing-body .form-header h2 {
          font-size: 24px;
          color: #E11D48;
          margin-bottom: 5px;
        }
        .landing-body .form-header p {
          color: #4B5563;
          font-size: 14px;
          font-weight: 600;
        }
        .landing-body .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .landing-body .form-group {
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .landing-body .form-group label {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          color: #0B0F19;
        }
        .landing-body .form-group input, .landing-body .form-group select {
          width: 100%;
          padding: 12px 16px;
          border: 2px solid #0B0F19;
          border-radius: 4px;
          font-family: 'Inter', sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #0B0F19;
          background-color: #F3F4F6;
        }
        .landing-body .form-group input:focus, .landing-body .form-group select:focus {
          outline: none;
          border-color: #E11D48;
          background-color: #FFFFFF;
        }
        .landing-body .submit-btn {
          background-color: #E11D48;
          color: #FFFFFF;
          width: 100%;
          border: 2px solid #0B0F19;
          border-radius: 4px;
          padding: 16px;
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 18px;
          cursor: pointer;
          box-shadow: 4px 4px 0px #0B0F19;
          transition: all 0.1s ease;
          margin-top: 10px;
        }
        .landing-body .submit-btn:hover {
          background-color: #BE123C;
          transform: translate(2px, 2px);
          box-shadow: 2px 2px 0px #0B0F19;
        }
        .landing-body .form-guarantee {
          font-size: 12px;
          color: #4B5563;
          text-align: center;
          margin-top: 15px;
          font-weight: 600;
        }

        .landing-body .clients-section {
          padding: 50px 0;
          border-bottom: 3px solid #0B0F19;
          text-align: center;
          background-color: #FFDE00;
        }
        .landing-body .section-tag {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 800;
          font-size: 15px;
          letter-spacing: 2px;
          color: #0B0F19;
          margin-bottom: 15px;
        }
        .landing-body .clients-desc {
          font-size: 18px;
          font-weight: 700;
          margin-bottom: 25px;
        }
        .landing-body .clients-grid {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 30px;
          flex-wrap: wrap;
        }
        .landing-body .client-name {
          background-color: #FFFFFF;
          color: #0B0F19;
          font-family: 'Outfit', sans-serif;
          font-weight: 800;
          font-size: 18px;
          padding: 10px 20px;
          border: 3px solid #0B0F19;
          box-shadow: 3px 3px 0px #0B0F19;
        }
        .landing-body .italic-more {
          font-style: italic;
          font-weight: 600;
          background-color: transparent;
          border: none;
          box-shadow: none;
          font-size: 20px;
        }

        .landing-body .value-section {
          padding: 80px 0;
          border-bottom: 3px solid #0B0F19;
        }
        .landing-body .value-h2-big {
          font-size: 40px;
          text-align: center;
          max-width: 900px;
          margin: 0 auto 50px auto;
          color: #0B0F19;
        }
        .landing-body .grid-two {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
        }
        .landing-body .pain-card, .landing-body .solution-card {
          border: 3px solid #0B0F19;
          border-radius: 8px;
          padding: 40px;
          box-shadow: 6px 6px 0px #0B0F19;
          position: relative;
        }
        .landing-body .pain-card {
          background-color: #FFF5F5;
        }
        .landing-body .solution-card {
          background-color: #F0FDF4;
        }
        .landing-body .card-icon {
          position: absolute;
          top: -20px;
          left: 40px;
          width: 44px;
          height: 44px;
          border: 3px solid #0B0F19;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 18px;
          box-shadow: 2px 2px 0px #0B0F19;
        }
        .landing-body .pain-card h3, .landing-body .solution-card h3 {
          font-size: 22px;
          margin-bottom: 20px;
        }
        .landing-body .bullet-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .landing-body .bullet-list li {
          position: relative;
          padding-left: 20px;
          font-size: 15px;
          font-weight: 600;
        }
        .landing-body .bullet-list li::before {
          content: "•";
          position: absolute;
          left: 0;
          color: #0B0F19;
          font-size: 20px;
          line-height: 1;
          top: -2px;
        }

        .landing-body .steps-section {
          background-color: #F3F4F6;
          padding: 80px 0;
          border-bottom: 3px solid #0B0F19;
        }
        .landing-body .steps-sub {
          font-size: 18px;
          color: #4B5563;
          margin-top: -30px;
          margin-bottom: 50px;
          font-weight: 600;
        }
        .landing-body .grid-three {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 30px;
        }
        .landing-body .step-card {
          background-color: #FFFFFF;
          border: 3px solid #0B0F19;
          border-radius: 8px;
          padding: 40px 25px;
          box-shadow: 4px 4px 0px #0B0F19;
          text-align: center;
        }
        .landing-body .step-num {
          width: 50px;
          height: 50px;
          background-color: #FFDE00;
          border: 3px solid #0B0F19;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 22px;
          margin: 0 auto 20px auto;
          box-shadow: 3px 3px 0px #0B0F19;
        }
        .landing-body .step-card h3 {
          font-size: 20px;
          margin-bottom: 15px;
        }
        .landing-body .step-card p {
          color: #4B5563;
          font-size: 14px;
          line-height: 1.6;
          font-weight: 500;
        }

        .landing-body .testimonial-section {
          padding: 80px 0;
          border-bottom: 3px solid #0B0F19;
          background-color: #FFFFFF;
        }
        .landing-body .testimonial-box {
          max-width: 800px;
          margin: 40px auto 0 auto;
          background-color: #F3F4F6;
          border: 3px solid #0B0F19;
          box-shadow: 6px 6px 0px #0B0F19;
          padding: 40px;
          border-radius: 8px;
        }
        .landing-body .testimonial-text {
          font-size: 18px;
          font-weight: 600;
          line-height: 1.6;
          margin-bottom: 25px;
          position: relative;
          font-style: italic;
        }
        .landing-body .testimonial-author {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .landing-body .author-sub {
          font-size: 13px;
          font-weight: 700;
          color: #4B5563;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .landing-body .final-cta {
          background-color: #0B0F19;
          color: #FFFFFF;
          padding: 100px 0;
          border-bottom: 3px solid #0B0F19;
        }
        .landing-body .final-title {
          font-size: 48px;
          margin-bottom: 25px;
          max-width: 900px;
          margin-left: auto;
          margin-right: auto;
          color: #FFFFFF;
        }
        .landing-body .final-sub {
          color: #F3F4F6;
          font-size: 20px;
          margin-bottom: 40px;
          font-weight: 500;
        }
        .landing-body .big-cta-btn {
          display: inline-block;
          background-color: #FFDE00;
          color: #0B0F19;
          text-decoration: none;
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 20px;
          padding: 20px 40px;
          border: 3px solid #0B0F19;
          border-radius: 4px;
          box-shadow: 4px 4px 0px #FFFFFF;
          transition: all 0.1s ease;
        }
        .landing-body .big-cta-btn:hover {
          background-color: #E6C800;
          transform: translate(2px, 2px);
          box-shadow: 2px 2px 0px #FFFFFF;
        }
        .landing-body .cta-subtext {
          color: #9CA3AF;
          font-size: 13px;
          margin-top: 20px;
          font-weight: 600;
        }

        .landing-body .main-footer {
          background-color: #030712;
          color: #9CA3AF;
          padding: 60px 0;
          text-align: center;
          font-size: 13px;
          font-weight: 500;
        }
        .landing-body .footer-logo {
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 24px;
          color: #FFFFFF;
          margin-bottom: 10px;
        }
        .landing-body .footer-address {
          margin-bottom: 20px;
          font-weight: 600;
        }
        .landing-body .footer-copy {
          border-top: 1px solid #1F2937;
          padding-top: 20px;
          max-width: 600px;
          margin: 0 auto;
        }

        .landing-body .mobile-sticky-footer {
          position: fixed;
          bottom: 0;
          left: 0;
          width: 100%;
          background-color: #FFFFFF;
          border-top: 3px solid #0B0F19;
          display: grid;
          grid-template-columns: 1fr 1fr;
          z-index: 99;
        }
        .landing-body .sticky-btn {
          text-align: center;
          padding: 16px 10px;
          font-family: 'Outfit', sans-serif;
          font-weight: 900;
          font-size: 16px;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .landing-body .tel-btn {
          background-color: #0B0F19;
          color: #FFFFFF;
          border-right: 1.5px solid #0B0F19;
        }
        .landing-body .wa-btn {
          background-color: #10B981;
          color: #FFFFFF;
          border-left: 1.5px solid #0B0F19;
        }

        .landing-body .success-message {
          background-color: #D1FAE5;
          color: #065F46;
          border: 2px solid #10B981;
          padding: 20px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 15px;
          text-align: center;
        }
        
        .landing-body .error-text {
          color: #E11D48;
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 15px;
        }

        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        .landing-body .animate-pulse {
          animation: pulse 2s infinite ease-in-out;
        }

        @media (max-width: 900px) {
          .landing-body .hero-title {
            font-size: 38px;
          }
          .landing-body .grid-two {
            grid-template-columns: 1fr;
            gap: 30px;
          }
          .landing-body .grid-three {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .landing-body .value-h2-big {
            font-size: 30px;
          }
          .landing-body .final-title {
            font-size: 32px;
          }
          .landing-body .big-cta-btn {
            font-size: 16px;
            padding: 16px 24px;
          }
        }

        @media (max-width: 600px) {
          .landing-body .alert-banner {
            font-size: 12px;
            padding: 8px;
          }
          .landing-body .logo {
            font-size: 22px;
          }
          .landing-body .hero-section {
            padding: 40px 0;
          }
          .landing-body .badge-warning {
            font-size: 11px;
            padding: 4px 8px;
          }
          .landing-body .hero-subtitle {
            font-size: 15px;
          }
          .landing-body .hero-features {
            gap: 15px;
          }
          .landing-body .feature-item {
            font-size: 14px;
            padding: 8px 12px;
          }
          .landing-body .form-card {
            padding: 20px;
          }
          .landing-body .form-row {
            grid-template-columns: 1fr;
            gap: 0;
          }
          .landing-body .submit-btn {
            font-size: 15px;
            padding: 14px;
          }
          .landing-body .client-name {
            font-size: 14px;
            padding: 6px 12px;
          }
        }
      `}</style>
    </div>
  )
}