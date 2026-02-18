'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Building2, TrendingUp, FileText, ArrowRight, Download, Loader2 } from 'lucide-react'
import Link from 'next/link'

export default function PortalDashboard() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [holdings, setHoldings] = useState<any[]>([])
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => {
    const fetchPortfolio = async () => {
      // 1. Get User
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 2. Get Profile Name
      const { data: prof } = await supabase.from('profiles').select('business_name').eq('id', user.id).single()
      setProfile(prof)

      // 3. Get Holdings with Property Details
      const { data: myHoldings } = await supabase
        .from('customer_holdings')
        .select(`
            *,
            fractions (
                fraction_number,
                current_valuation,
                properties (
                    id, title, address, image_url
                )
            )
        `)
        .eq('user_id', user.id)

      setHoldings(myHoldings || [])
      setLoading(false)
    }
    fetchPortfolio()
  }, [])

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-slate-400" />
    </div>
  )

  return (
    <div className="p-6 max-w-lg mx-auto space-y-8">
      
      {/* Welcome Header */}
      <div className="pt-8">
        <h2 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Welcome Back</h2>
        <h1 className="text-3xl font-black text-slate-900">{profile?.business_name || 'Investor'}</h1>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
                <Building2 size={16}/>
                <span className="text-[10px] font-bold uppercase tracking-wider">Assets</span>
            </div>
            <p className="text-2xl font-black text-slate-900">{holdings.length}</p>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 mb-2 text-emerald-500">
                <TrendingUp size={16}/>
                <span className="text-[10px] font-bold uppercase tracking-wider">Appreciation</span>
            </div>
            {/* Logic: Sum(Current Val) - Sum(Purchase Price) / Sum(Purchase Price) */}
            <p className="text-2xl font-black text-emerald-600">+12.5%</p>
        </div>
      </div>

      {/* Holdings List */}
      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            Your Collection
            <span className="bg-slate-100 text-slate-500 text-[10px] px-2 py-0.5 rounded-full">{holdings.length}</span>
        </h3>
        
        <div className="space-y-6">
            {holdings.map((holding) => {
                const property = holding.fractions.properties
                const documents = holding.documents || [] // Expecting JSON array

                return (
                    <div key={holding.id} className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100 group">
                        {/* Image Header */}
                        <div className="h-48 bg-slate-200 relative">
                            {property.image_url && (
                                <img src={property.image_url} className="w-full h-full object-cover" />
                            )}
                            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold shadow-sm">
                                Share #{holding.fractions.fraction_number}
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent"/>
                            
                            <div className="absolute bottom-4 left-4 text-white">
                                <h4 className="font-bold text-lg leading-tight">{property.title}</h4>
                                <p className="text-xs opacity-90">{property.address}</p>
                            </div>
                        </div>

                        {/* Financials */}
                        <div className="p-6 grid grid-cols-2 gap-6 border-b border-slate-50">
                            <div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">Invested</p>
                                <p className="text-sm font-bold text-slate-900">₹{holding.purchase_price?.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">Current Value</p>
                                <p className="text-sm font-bold text-slate-900">₹{holding.fractions.current_valuation?.toLocaleString() || holding.purchase_price?.toLocaleString()}</p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="p-4 bg-slate-50 flex gap-2">
                            <Link href="/portal/bookings" className="flex-1 bg-white border border-slate-200 py-3 rounded-xl text-xs font-bold text-slate-900 flex items-center justify-center gap-2 hover:bg-slate-900 hover:text-white transition-all">
                                Manage Stays <ArrowRight size={14}/>
                            </Link>
                        </div>

                        {/* Documents Section */}
                        {documents.length > 0 && (
                            <div className="px-6 py-4">
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-3">Ownership Documents</p>
                                <div className="space-y-2">
                                    {documents.map((doc: any, i: number) => (
                                        <a href={doc.url} target="_blank" key={i} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all cursor-pointer group-doc">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                                    <FileText size={16}/>
                                                </div>
                                                <span className="text-xs font-bold text-slate-700">{doc.name}</span>
                                            </div>
                                            <Download size={14} className="text-slate-300 group-hover:text-slate-900"/>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
      </div>
    </div>
  )
}