import React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function RefundPolicy() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans selection:bg-amber-500/30 py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-amber-500 hover:text-amber-400 mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to Home
        </Link>
        
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Refund and Cancellation Policy</h1>
        <p className="text-sm text-slate-500 mb-8">Last Updated: December 22, 2025</p>

        <div className="space-y-8 leading-relaxed">
          <p>
            At NobogentAI (available at app.nobogent.com), we strive to provide the best real estate marketing automation tools. However, we understand that circumstances change. Please read our policy carefully regarding refunds and cancellations.
          </p>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">1. Subscription Cancellations</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Cancel Anytime:</strong> You may cancel your NobogentAI subscription at any time via the App settings or by contacting info@nobogent.com.</li>
              <li><strong>Effect of Cancellation:</strong> Upon cancellation, your access to premium features will continue until the end of your current billing cycle. After the cycle ends, your account will revert to a free version (if available) or be deactivated, and no further charges will be made.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">2. No Refund Policy</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>All Sales Are Final:</strong> As NobogentAI provides immediate access to digital software and marketing automation tools, <strong>we do not offer refunds</strong> once a subscription has been purchased.</li>
              <li><strong>No Exceptions:</strong> We do not provide refunds for partial months, unused time, or "change of mind" cancellations. Please ensure the software meets your requirements before purchasing a subscription.</li>
              <li><strong>Cancellations:</strong> You can cancel your subscription at any time to prevent future charges, but no refunds will be issued for the current billing cycle.</li>
            </ul>
          </section>

          <section className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h2 className="text-xl font-bold text-amber-500 mb-4">3. Important: Facebook Ad Spend</h2>
            <p className="mb-4">Please distinguish between payments made to NobogentAI and payments made to Facebook:</p>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li><strong>NobogentAI Subscription:</strong> Paid to us for the software tool.</li>
              <li><strong>Ad Budget:</strong> Paid directly to Meta (Facebook) for displaying your ads.</li>
            </ul>
            <p className="font-semibold text-white">
              NobogentAI cannot refund your Ad Budget. If you launch a campaign and spend money on Facebook ads, that money is paid to Meta. We have no control over those funds. If you wish to stop spending on ads, you must pause the campaign inside the NobogentAI app or your Facebook Ads Manager immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-4">4. How to Request a Refund</h2>
            <p className="mb-4">To request a refund for your software subscription, please email <a href="mailto:info@nobogent.com" className="text-amber-500 hover:underline">info@nobogent.com</a> with:</p>
            <ul className="list-disc pl-5 space-y-2 mb-4">
              <li>Your registered email address.</li>
              <li>Proof of payment (transaction ID).</li>
              <li>The reason for the refund request.</li>
            </ul>
            <p>We will review your request and respond within 3–5 business days.</p>
          </section>
        </div>
      </div>
    </div>
  )
}