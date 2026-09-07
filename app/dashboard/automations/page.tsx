'use client'

import React, { Suspense, Component, ErrorInfo, ReactNode } from 'react'
import FlowsPage from '../flows/page'
import { Loader2, AlertCircle, RotateCcw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class AutomationsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Automations Suite ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#F8FAFC] p-4">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 border border-slate-200 shadow-sm text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <AlertCircle size={24} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Automations Studio</h2>
              <p className="text-xs text-slate-500 mt-1">
                {this.state.error?.message || 'A network or rendering glitch occurred. Click below to reload.'}
              </p>
            </div>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Reload Automations</span>
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function AutomationsPage() {
  return (
    <AutomationsErrorBoundary>
      <Suspense fallback={
        <div className="h-screen w-full flex items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
            <p className="text-sm font-semibold text-slate-600">Loading Automations Suite...</p>
          </div>
        </div>
      }>
        <FlowsPage />
      </Suspense>
    </AutomationsErrorBoundary>
  )
}
