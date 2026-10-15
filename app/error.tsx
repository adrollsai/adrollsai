'use client'

import React, { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Global App Error Boundary Caught]:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-lg w-full text-center shadow-2xl backdrop-blur-md space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto shadow-inner">
          <AlertTriangle className="w-8 h-8" />
        </div>
        
        <div className="space-y-2">
          <h2 className="text-xl font-black text-white tracking-tight">
            Something unexpected occurred
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
            A temporary client exception was caught. Your data remains completely safe in the cloud.
          </p>
          {error?.message && (
            <div className="mt-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400 font-mono text-left overflow-x-auto max-h-24 custom-scrollbar">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <RefreshCw size={14} />
            Try again
          </button>
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/dashboard/crm'
              }
            }}
            className="w-full sm:w-auto px-6 py-2.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-600/60 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <Home size={14} />
            Go to CRM
          </button>
        </div>
      </div>
    </div>
  )
}
