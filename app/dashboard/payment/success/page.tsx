'use client'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'

export default function PaymentSuccess() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 size={32} />
        </div>
        <h1 className="text-2xl font-bold mb-2">Payment Successful!</h1>
        <p className="text-slate-500 mb-8">Your transaction has been processed in Sandbox mode.</p>
        <Link href="/dashboard/market" className="bg-slate-900 text-white px-6 py-3 rounded-xl">
            Back to Market
        </Link>
    </div>
  )
}