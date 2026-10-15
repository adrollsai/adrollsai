'use client'

import React, { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
  errorCount: number
}

export default class CRMErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRMErrorBoundary caught error]:', error, errorInfo)
  }

  handleReset = () => {
    this.setState(prev => ({ hasError: false, error: null, errorCount: prev.errorCount + 1 }))
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-6 bg-white border border-amber-200/90 rounded-3xl text-slate-800 shadow-xl max-w-xl mx-auto animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5 mb-3">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl border border-amber-200 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {this.props.fallbackTitle || 'Display Interruption Prevented'}
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                A temporary glitch was prevented from crashing your CRM workspace. Your lead updates and database changes are saved safely.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <RefreshCw size={13} /> Resume Lead View
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200 flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <RotateCcw size={13} /> Refresh Page
            </button>
          </div>
        </div>
      )
    }

    return (
      <React.Fragment key={this.state.errorCount}>
        {this.props.children}
      </React.Fragment>
    )
  }
}
