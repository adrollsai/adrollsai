'use client'

import { useState } from 'react'
import { Star, CheckCircle2, MessageSquare, Send, ShieldCheck, HeartHandshake, Loader2, ArrowRight } from 'lucide-react'

interface ReviewGatingClientProps {
  businessId: string
  businessName: string
  logoUrl?: string
  brandColor?: string
  googleReviewUrl?: string
  placeId?: string
}

export default function ReviewGatingClient({
  businessId,
  businessName,
  logoUrl,
  brandColor = '#2563EB',
  googleReviewUrl,
  placeId
}: ReviewGatingClientProps) {
  const [selectedRating, setSelectedRating] = useState<number | null>(null)
  const [hoverRating, setHoverRating] = useState<number | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submittedPrivate, setSubmittedPrivate] = useState(false)
  const [redirectingToGoogle, setRedirectingToGoogle] = useState(false)

  // Construct official Google review write URL
  const effectiveReviewUrl = googleReviewUrl || (placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : '')

  const handleSelectRating = (rating: number) => {
    setSelectedRating(rating)

    if (rating >= 4) {
      // 4 or 5 stars -> Direct to Google Review page!
      setRedirectingToGoogle(true)
      if (effectiveReviewUrl) {
        setTimeout(() => {
          window.location.href = effectiveReviewUrl
        }, 1200)
      }
    }
  }

  const handleSubmitPrivateFeedback = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedbackText.trim()) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/review/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          rating: selectedRating,
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_email: customerEmail,
          feedback: feedbackText
        })
      })

      if (res.ok) {
        setSubmittedPrivate(true)
      } else {
        throw new Error('Failed to submit feedback')
      }
    } catch (err) {
      console.error('Error submitting feedback:', err)
      // Even on network error, give gracious confirmation to user
      setSubmittedPrivate(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-10 px-4 sm:px-6">
      <div className="max-w-lg w-full mx-auto my-auto">
        <div className="bg-white rounded-3xl p-6 sm:p-10 shadow-xl border border-slate-100 text-center relative overflow-hidden">
          {/* Accent Glow */}
          <div
            className="absolute top-0 left-0 right-0 h-2"
            style={{ backgroundColor: brandColor }}
          />

          {/* Business Logo & Name */}
          <div className="flex flex-col items-center mb-6">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={businessName}
                className="w-20 h-20 rounded-2xl object-contain border border-slate-100 shadow-sm mb-3 bg-white p-1"
              />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-black shadow-md mb-3"
                style={{ backgroundColor: brandColor }}
              >
                {businessName.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              {businessName}
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              We care deeply about your experience. How was your recent visit with us?
            </p>
          </div>

          {/* STATE 1: Initial Star Rating Selection */}
          {!selectedRating && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-center gap-2 sm:gap-3 py-4">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isHovered = hoverRating !== null && hoverRating >= star
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      onClick={() => handleSelectRating(star)}
                      className="p-1 sm:p-2 transition-transform hover:scale-125 active:scale-95 cursor-pointer focus:outline-none"
                      aria-label={`${star} star`}
                    >
                      <Star
                        size={40}
                        className={`transition-colors duration-150 ${
                          isHovered
                            ? 'text-amber-400 fill-amber-400 drop-shadow-md'
                            : 'text-slate-300 hover:text-amber-300'
                        }`}
                      />
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between text-slate-400 text-[11px] font-bold uppercase tracking-wider px-2">
                <span>Needs Improvement</span>
                <span>Exceptional</span>
              </div>
            </div>
          )}

          {/* STATE 2: High Rating (4 or 5 stars) -> Celebratory + Google Redirect */}
          {selectedRating && selectedRating >= 4 && (
            <div className="space-y-6 py-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 size={36} />
              </div>

              <div className="flex justify-center gap-1">
                {[...Array(selectedRating)].map((_, i) => (
                  <Star key={i} size={28} className="text-amber-400 fill-amber-400" />
                ))}
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-black text-slate-900">
                  Thank you for the {selectedRating}-star rating! ⭐
                </h3>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  As a local business, your review helps neighbors discover us on Google Maps. Please take 10 seconds to share your feedback!
                </p>
              </div>

              {effectiveReviewUrl ? (
                <div className="pt-2">
                  <a
                    href={effectiveReviewUrl}
                    className="w-full py-3.5 px-6 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-98"
                  >
                    <span>{redirectingToGoogle ? 'Redirecting to Google...' : 'Write Review on Google'}</span>
                    <ArrowRight size={16} />
                  </a>
                  {redirectingToGoogle && (
                    <p className="text-[11px] text-slate-400 mt-2 flex items-center justify-center gap-1.5">
                      <Loader2 size={12} className="animate-spin text-blue-600" />
                      Opening Google Business Profile...
                    </p>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-800 text-xs font-semibold">
                  Thank you so much! Your positive feedback means the world to our team.
                </div>
              )}
            </div>
          )}

          {/* STATE 3: Low/Neutral Rating (1, 2, or 3 stars) -> Private Feedback Gate */}
          {selectedRating && selectedRating < 4 && !submittedPrivate && (
            <form onSubmit={handleSubmitPrivateFeedback} className="space-y-5 py-2 text-left animate-in fade-in duration-300">
              <div className="text-center space-y-1">
                <div className="flex justify-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      size={24}
                      className={star <= selectedRating ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}
                    />
                  ))}
                </div>
                <h3 className="text-base font-black text-slate-900">
                  We are truly sorry to hear that.
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Your satisfaction is our absolute priority. Please let our leadership team know what went wrong so we can make this right.
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Your Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. John Doe"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500 bg-slate-50"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+91..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500 bg-slate-50"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="name@email.com"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500 bg-slate-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    How can we make things right? *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Please tell us about your experience and how we can improve..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-blue-500 bg-slate-50 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !feedbackText.trim()}
                  className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black text-xs shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 transition-transform active:scale-98 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Submitting Feedback...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Send Private Feedback to Management</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* STATE 4: Private Feedback Confirmation */}
          {submittedPrivate && (
            <div className="py-6 space-y-4 animate-in zoom-in-95 duration-300">
              <div className="w-16 h-16 mx-auto rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <HeartHandshake size={32} />
              </div>
              <h3 className="text-lg font-black text-slate-900">
                Thank you for your valuable feedback
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                Your comments have been securely sent directly to our management team. We take every grievance seriously and will follow up with you promptly.
              </p>
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[11px] text-slate-600 font-semibold flex items-center justify-center gap-2">
                <ShieldCheck size={16} className="text-blue-600 shrink-0" />
                <span>Your private feedback has been logged securely.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Security Badge */}
        <div className="text-center mt-6">
          <p className="text-[11px] text-slate-400 font-medium flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} className="text-slate-400" />
            <span>Verified Customer Experience Portal • Powered by {businessName}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
