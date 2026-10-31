'use client'

import React, { useEffect } from 'react'
import { AlertCircle, RefreshCw, LayoutDashboard } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Dashboard Error Boundary Caught]:', error)
  }, [error])

  const handleFullReset = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('crm_filter_stage')
        sessionStorage.removeItem('crm_filter_agent')
        sessionStorage.removeItem('crm_filter_campaign')
        sessionStorage.removeItem('crm_filter_date')
      } catch (e) {}
      window.location.reload()
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center shadow-xl space-y-5 animate-in fade-in duration-200">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center mx-auto shadow-xs">
          <AlertCircle className="w-7 h-7" />
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-black text-slate-900 tracking-tight">
            Display Interruption Prevented
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed font-medium">
            Your workspace and updates were saved safely. Click below to refresh your view.
          </p>
          {error?.message && (
            <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-left max-h-36 overflow-auto">
              <span className="text-[10px] font-bold text-rose-500 uppercase tracking-wider block mb-1">Diagnostic Detail</span>
              <p className="text-[11px] font-mono text-rose-700 break-words whitespace-pre-wrap">{error.message}</p>
              {error.digest && <span className="text-[9px] font-mono text-rose-400 block mt-1">Digest: {error.digest}</span>}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
          <button
            type="button"
            onClick={() => reset()}
            className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <RefreshCw size={14} />
            Resume View
          </button>
          <button
            type="button"
            onClick={handleFullReset}
            className="w-full sm:w-auto px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200/80 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <LayoutDashboard size={14} />
            Reload Workspace
          </button>
        </div>
      </div>
    </div>
  )
}
