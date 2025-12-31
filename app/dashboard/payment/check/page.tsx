'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, XCircle } from 'lucide-react'

function PaymentStatusContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const orderId = searchParams.get('orderId')
  const [status, setStatus] = useState<'LOADING' | 'SUCCESS' | 'FAILED'>('LOADING')

  useEffect(() => {
    if (!orderId) return

    const verifyPayment = async () => {
      try {
        const res = await fetch('/api/phonepe/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        })
        const data = await res.json()
        
        if (data.status === 'SUCCESS') {
          setStatus('SUCCESS')
          // Optional: Redirect after 3 seconds
          setTimeout(() => router.push('/dashboard/ads'), 3000)
        } else {
          setStatus('FAILED')
        }
      } catch (error) {
        console.error(error)
        setStatus('FAILED')
      }
    }

    verifyPayment()
  }, [orderId, router])

  if (status === 'LOADING') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <Loader2 className="w-12 h-12 animate-spin text-slate-400 mb-4" />
        <h2 className="text-xl font-bold">Verifying Payment...</h2>
        <p className="text-slate-500">Please do not close this window.</p>
      </div>
    )
  }

  if (status === 'SUCCESS') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="text-2xl font-bold text-green-700">Payment Successful!</h2>
        <p className="text-slate-500 mt-2">Redirecting you back to Ads Manager...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
        <XCircle size={32} />
      </div>
      <h2 className="text-2xl font-bold text-red-700">Payment Failed</h2>
      <p className="text-slate-500 mt-2">The transaction could not be completed.</p>
      <button onClick={() => router.push('/dashboard/ads')} className="mt-6 bg-slate-900 text-white px-6 py-2 rounded-xl">
        Try Again
      </button>
    </div>
  )
}

export default function PaymentCheckPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PaymentStatusContent />
    </Suspense>
  )
}