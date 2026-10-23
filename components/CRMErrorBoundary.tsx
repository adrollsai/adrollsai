'use client'

import React, { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw, ArrowLeft, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
  errorCount: number
  showDetails: boolean
  copied: boolean
}

export default class CRMErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0,
      showDetails: false,
      copied: false
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRMErrorBoundary caught error]:', error, errorInfo)
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: prev.errorCount + 1,
      showDetails: false
    }))
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  handleGoBackToCRM = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/dashboard/crm'
    }
  }

  handleCopyError = () => {
    if (typeof window === 'undefined') return
    const errorDetails = [
      `Title: ${this.props.fallbackTitle || 'CRM Workspace Error'}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `Error: ${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Unknown error'}`,
      `Stack: ${this.state.error?.stack || 'No stack'}`,
      `Component Stack: ${this.state.errorInfo?.componentStack || 'No component stack'}`
    ].join('\n\n')

    navigator.clipboard.writeText(errorDetails).then(() => {
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2500)
    }).catch(() => {})
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-5 sm:p-6 my-6 bg-white border border-amber-200/90 rounded-3xl text-slate-800 shadow-xl max-w-xl mx-auto animate-in fade-in duration-200">
          <div className="flex items-start gap-3.5 mb-3">
            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-2xl border border-amber-200 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-slate-900">
                {this.props.fallbackTitle || 'Display Interruption Prevented'}
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                A temporary glitch was prevented from crashing your CRM workspace. Your lead updates and database changes are saved safely.
              </p>
              {this.state.error?.message && (
                <div className="mt-2 text-[11px] font-mono bg-amber-50/70 border border-amber-200 text-amber-900 px-2.5 py-1.5 rounded-xl break-words">
                  ⚠️ {this.state.error.message}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <RefreshCw size={13} /> Resume Lead View
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all border border-slate-200 flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <RotateCcw size={13} /> Refresh Page
            </button>
            <button
              type="button"
              onClick={this.handleGoBackToCRM}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-95 ml-auto"
            >
              <ArrowLeft size={13} /> Back to Leads
            </button>
          </div>

          {/* Collapsible Error Diagnostics */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors cursor-pointer"
              >
                {this.state.showDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {this.state.showDetails ? 'Hide Error Diagnostics' : 'View Diagnostics & Trace'}
              </button>
              {this.state.showDetails && (
                <button
                  type="button"
                  onClick={this.handleCopyError}
                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer bg-blue-50 px-2 py-1 rounded-lg border border-blue-200"
                >
                  {this.state.copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                  {this.state.copied ? 'Copied to Clipboard!' : 'Copy Diagnostics'}
                </button>
              )}
            </div>

            {this.state.showDetails && (
              <div className="mt-2.5 p-3 bg-slate-950 text-slate-200 rounded-2xl text-[10px] font-mono overflow-x-auto max-h-60 space-y-1.5 leading-relaxed">
                <p className="text-amber-400 font-bold">{this.state.error?.name}: {this.state.error?.message}</p>
                {this.state.error?.stack && (
                  <pre className="text-slate-400 whitespace-pre-wrap">{this.state.error.stack}</pre>
                )}
                {this.state.errorInfo?.componentStack && (
                  <div className="pt-2 border-t border-slate-800 text-slate-500">
                    <p className="font-bold text-slate-400">Component Stack:</p>
                    <pre className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</pre>
                  </div>
                )}
              </div>
            )}
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

