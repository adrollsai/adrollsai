import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-amber-500/30 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-amber-500 hover:text-amber-400 mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </Link>
        
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Terms and Conditions</h1>
        <p className="text-sm text-slate-500 mb-8">Last Updated: December 22, 2025</p>

        <div className="space-y-8 leading-relaxed">
          <p>
            Welcome to NobogentAI. By accessing our website (nobogent.com) or using our mobile application (the "App", available at app.nobogent.com), you agree to be bound by these Terms and Conditions ("Terms"). If you disagree with any part of these terms, you may not access the Service.
          </p>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">1. Definitions</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>"Company," "We," "Us," or "Our"</strong> refers to RAHUL CHOPRA.</li>
              <li><strong>"Service"</strong> refers to the NobogentAI application and website which provides marketing automation, image branding, and ad management for real estate professionals.</li>
              <li><strong>"User," "You"</strong> refers to the individual or entity accessing the Service.</li>
              <li><strong>"Platform"</strong> refers to third-party social media sites, specifically Facebook and Instagram (Meta Platforms, Inc.).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">2. Use of Services</h2>
            <p className="mb-2">NobogentAI provides tools to automate real estate marketing. By using our Service, you acknowledge and agree that:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>License:</strong> We grant you a revocable, non-exclusive, non-transferable, limited license to use the App strictly in accordance with these Terms.</li>
              <li><strong>Account Security:</strong> You are responsible for maintaining the confidentiality of your login credentials. You accept responsibility for all activities that occur under your account.</li>
              <li><strong>Professional Usage:</strong> You agree to use the Service only for legitimate business purposes related to real estate marketing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">3. Dependence on Third-Party Platforms (Meta)</h2>
            <p className="mb-2">Our Service relies heavily on APIs provided by Meta (Facebook and Instagram). By using NobogentAI, you explicitly acknowledge:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Availability:</strong> We do not guarantee that the Service will always be available if Meta changes its API, policies, or creates technical limitations.</li>
              <li><strong>Account Bans:</strong> You are responsible for keeping your Facebook Ad Account and Business Page in good standing. NobogentAI is not liable if your ad account is restricted, banned, or disabled by Meta due to policy violations.</li>
              <li><strong>Permission Revocation:</strong> If you revoke the permissions granted to NobogentAI via Facebook Settings, our Service will stop functioning.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">4. Content and Compliance (Housing Ads)</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>User Responsibility:</strong> You are solely responsible for the text, images, and claims made in your marketing materials.</li>
              <li><strong>Housing Discrimination:</strong> You agree to strictly adhere to the Fair Housing Act and Meta’s "Special Ad Category: Housing" policies. You must not use our tools to discriminate based on race, color, religion, national origin, sex, disability, or familial status.</li>
              <li><strong>NobogentAI Rights:</strong> We reserve the right to refuse to process or publish content that we determine is illegal, offensive, or in violation of Meta’s advertising policies.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">5. Payments and Subscriptions</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Service Fees:</strong> You agree to pay the subscription fees associated with the plan you select within the App.</li>
              <li><strong>Ad Budget Distinction:</strong> <span className="text-amber-500 font-bold">IMPORTANT:</span> Fees paid to NobogentAI are for the use of the software only. The budget for running ads (Ad Spend) is paid directly to Facebook/Meta through your connected Ad Account. We do not handle, hold, or refund your Facebook ad budget.</li>
              <li><strong>Billing Cycle:</strong> Subscriptions are billed in advance on a recurring basis (monthly or annually) depending on your selection.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">6. Intellectual Property</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Your Content:</strong> You retain ownership of the photos, logos, and branding assets you upload. By uploading them, you grant us a license to process and display them to provide the Service.</li>
              <li><strong>Our Content:</strong> The NobogentAI code, design, templates, and algorithms are the intellectual property of RAHUL CHOPRA and are protected by copyright laws.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">7. Limitation of Liability</h2>
            <p className="mb-2">To the maximum extent permitted by applicable law, RAHUL CHOPRA shall not be liable for:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Any indirect, incidental, or consequential damages (including loss of profits or data).</li>
              <li>Any loss of ad budget due to improperly configured campaigns or Facebook errors.</li>
              <li>Service interruptions caused by third-party providers (e.g., Cloudflare, Supabase, Meta).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">8. Governing Law</h2>
            <p>These Terms shall be governed by and construed in accordance with the laws of India. Any disputes relating to these terms shall be subject to the exclusive jurisdiction of the courts in Haryana, India.</p>
          </section>

          <section className="border-t border-slate-800 pt-8 mt-8">
            <h2 className="text-xl font-bold text-white mb-4">9. Contact Us</h2>
            <p>For any questions regarding these Terms, please contact us at: <a href="mailto:adrollsai@gmail.com" className="text-amber-500 hover:underline">adrollsai@gmail.com</a> or by phone at <a href="tel:+919872669935" className="text-amber-500 hover:underline">+91-98726 69935</a></p>
          </section>
        </div>
      </div>
    </div>
  )
}