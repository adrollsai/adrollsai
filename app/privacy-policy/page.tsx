import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-amber-500/30 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-amber-500 hover:text-amber-400 mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </Link>
        
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Privacy Policy for AdRollsAI</h1>
        <p className="text-sm text-slate-500 mb-8">Last Updated: December 18, 2025</p>

        <div className="space-y-8 leading-relaxed">
          <p>
            ADROLLS AI ("we," "us," or "our") operates the AdRollsAI application (the "App") and the website adrolls.in. We are committed to protecting your privacy and ensuring you have control over your data. This Privacy Policy explains how we collect, use, and disclose information when you use our App, particularly in relation to your Facebook and Instagram data.
          </p>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">1. Information We Collect</h2>
            <p className="mb-4">We collect information to provide our real estate marketing automation services. This includes:</p>
            
            <h3 className="font-semibold text-white mb-2">A. Information You Provide</h3>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li><strong>Account Information:</strong> Name, email address (adrollsai@gmail.com), and profile picture when you sign up.</li>
              <li><strong>Business Profile:</strong> Your real estate agent profile details (e.g., phone number, business logo, branding colors).</li>
            </ul>

            <h3 className="font-semibold text-white mb-2">B. Information from Third-Party Social Media Services (Meta/Facebook)</h3>
            <p className="mb-2">When you connect your Facebook account, we access specific data based on the permissions you grant:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Public Profile:</strong> To identify you and create your account.</li>
              <li><strong>Pages List (pages_show_list):</strong> To allow you to select which Facebook Page you want to publish content to.</li>
              <li><strong>Page Content & Posts (pages_manage_posts, pages_read_engagement):</strong> To publish marketing creatives, view comments, and track engagement on your behalf.</li>
              <li><strong>Ad Accounts (ads_management, ads_read):</strong> To create, launch, and manage real estate ad campaigns on your behalf.</li>
              <li><strong>Instagram Business Account:</strong> To publish content to your connected Instagram account.</li>
              <li><strong>Lead Data (leads_retrieval):</strong> To retrieve leads generated from your ads and display them in your CRM dashboard.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">2. How We Use Your Information</h2>
            <p className="mb-4">We use your data solely to provide the App's functionality:</p>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li><strong>To Brand Your Content:</strong> We use your profile data to "stamp" images with your name and photo.</li>
              <li><strong>To Publish Content:</strong> We use Page permissions to post the images you select to your Facebook and Instagram feeds.</li>
              <li><strong>To Manage Ads:</strong> We use Ad Account permissions to construct and launch housing-compliant ad campaigns.</li>
              <li><strong>To Manage Leads:</strong> We sync lead data from Facebook Forms to your internal CRM so you can contact potential clients.</li>
            </ul>
            <p>We do not use your Facebook data for any purpose other than providing these direct services to you. We do not use your data for surveillance or sell your data to data brokers.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">3. Data Sharing and Disclosure</h2>
            <p className="mb-2">We do not sell your personal data. We may share data only in the following circumstances:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Service Providers:</strong> We use trusted third-party providers (e.g., Supabase for database hosting, Cloudflare for image storage) to run our infrastructure. These providers are bound by confidentiality agreements.</li>
              <li><strong>Legal Compliance:</strong> If required by law or to protect our rights.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">4. Data Retention</h2>
            <p className="mb-2">We retain your personal data only for as long as is necessary for the purposes set out in this Privacy Policy.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Facebook Data:</strong> We do not store your Facebook Access Tokens permanently on the client side; they are securely handled by our authentication provider.</li>
              <li><strong>Lead Data:</strong> Leads retrieved from Facebook are stored in your private CRM database until you delete your account or request deletion.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">5. Your Rights and Data Deletion</h2>
            <p className="mb-2">You have the right to access, update, or delete your personal information.</p>
            <p className="mb-2"><strong>How to Delete Your Data:</strong> If you wish to remove the App's access to your Facebook data or delete your account entirely:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Via Facebook:</strong> You can remove our App's access at any time by going to your Facebook Settings &gt; Business Integrations and removing "AdRollsAI."</li>
              <li><strong>By Email:</strong> You can contact us at adrollsai@gmail.com with the subject "Data Deletion Request," and we will manually delete your data within 30 days.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">6. Compliance with Meta Platform Terms</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Limited Use:</strong> Our use of information received from Google or Meta APIs will adhere to the respective Limited Use Policies.</li>
              <li><strong>Housing Ads:</strong> We strictly enforce the "Special Ad Category: HOUSING" setting for all ad campaigns created via our platform to comply with Meta's non-discrimination policies.</li>
            </ul>
          </section>

          <section className="border-t border-slate-800 pt-8 mt-8">
            <h2 className="text-xl font-bold text-white mb-4">7. Contact Us</h2>
            <p className="mb-2">If you have any questions about this Privacy Policy, please contact us:</p>
            <ul className="space-y-1">
              <li><strong>Entity Name:</strong> ADROLLS AI</li>
              <li><strong>Email:</strong> <a href="mailto:adrollsai@gmail.com" className="text-amber-500 hover:underline">adrollsai@gmail.com</a></li>
              <li><strong>Location:</strong> India</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}