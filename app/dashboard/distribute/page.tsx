'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import DistributeManager from '@/components/DistributeManager'
import { LayoutGrid, Image as ImageIcon, Video, CheckCircle } from 'lucide-react'

type MasterCreative = {
    id: string
    url: string
    type: 'image' | 'video'
    created_at: string
}

export default function DistributePage() {
  const supabase = createClient()
  const [creatives, setCreatives] = useState<MasterCreative[]>([])
  const [selectedCreative, setSelectedCreative] = useState<MasterCreative | null>(null)
  
  useEffect(() => {
    const fetchCreatives = async () => {
        // Fetch valid creatives
        const { data } = await supabase
            .from('master_creatives')
            .select('*')
            .not('url', 'is', null) 
            .order('created_at', { ascending: false })
            .limit(20)
        
        if (data) setCreatives(data as any)
    }
    fetchCreatives()
  }, [])

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 pb-32">
        <div className="max-w-5xl mx-auto">
            
            {/* Header (Simplified) */}
            <div className="mb-8">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Distribution Center</h1>
                <p className="text-slate-500 mt-2">Select a creative and blast it to your team with auto-branding.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                
                {/* Creative Selector */}
                <div className="md:col-span-7 space-y-4">
                    <h2 className="font-bold text-slate-700 flex items-center gap-2">
                        <LayoutGrid size={18}/> Select Master Creative
                    </h2>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {creatives.map(c => (
                            <div 
                                key={c.id} 
                                onClick={() => setSelectedCreative(c)}
                                className={`aspect-square rounded-2xl overflow-hidden cursor-pointer border-4 transition-all relative group ${selectedCreative?.id === c.id ? 'border-purple-600 shadow-xl scale-105' : 'border-transparent hover:border-purple-200'}`}
                            >
                                <img src={c.url} className="w-full h-full object-cover bg-white"/>
                                {c.type === 'video' && <div className="absolute inset-0 flex items-center justify-center bg-black/20"><Video className="text-white"/></div>}
                                
                                {selectedCreative?.id === c.id && (
                                    <div className="absolute top-2 right-2 bg-purple-600 text-white p-1 rounded-full shadow-sm">
                                        <CheckCircle size={14}/>
                                    </div>
                                )}
                            </div>
                        ))}
                        {creatives.length === 0 && (
                            <div className="col-span-3 text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center gap-2">
                                <ImageIcon size={32} className="opacity-20"/>
                                <span className="text-xs">No creatives found.</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Manager Panel */}
                <div className="md:col-span-5">
                    <div className="sticky top-10">
                        {selectedCreative ? (
                            <div className="bg-white p-6 rounded-3xl shadow-xl shadow-purple-50 border border-purple-50">
                                <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 mb-6 border border-slate-100 relative">
                                    <img src={selectedCreative.url} className="w-full h-full object-contain"/>
                                </div>
                                <DistributeManager creative={selectedCreative} />
                            </div>
                        ) : (
                            <div className="h-64 bg-white rounded-3xl border border-slate-100 flex flex-col items-center justify-center text-slate-400 text-center p-6 shadow-sm">
                                <ImageIcon size={48} className="mb-4 text-slate-200"/>
                                <p className="text-sm font-medium">Select a creative on the left to start.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    </div>
  )
}