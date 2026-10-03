'use client'

import React, { Component, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class CRMErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CRMErrorBoundary caught error]:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 my-6 bg-amber-50/90 border border-amber-200 rounded-3xl text-slate-800 shadow-sm max-w-xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-amber-100 text-amber-700 rounded-2xl shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {this.props.fallbackTitle || 'Display Interruption Prevented'}
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                A temporary glitch was prevented from crashing your CRM workspace. Your active filters and leads remain safe.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw size={14} /> Resume Lead View
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
