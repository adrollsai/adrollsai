'use client'

import { useState, useEffect } from 'react'
import { MessageCircle, UserPlus, CalendarClock, BellRing, LucideIcon } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// 1. Map String names to Actual Icons
const iconMap: Record<string, LucideIcon> = {
  'UserPlus': UserPlus,
  'CalendarClock': CalendarClock,
  'BellRing': BellRing,
  'MessageCircle': MessageCircle
}

type Automation = {
  id: string
  title: string
  description: string
  icon_name: string
  is_active: boolean
  stats: string
}

export default function AutomationPage() {
  const supabase = createClient()
  const [flows, setFlows] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)

  // 2. Fetch Automations from DB
  useEffect(() => {
    const fetchFlows = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })

      if (data) setFlows(data)
      setLoading(false)
    }
    fetchFlows()
  }, [])

  // 3. Toggle Function (Updates DB immediately)
  const toggleFlow = async (id: string, currentStatus: boolean) => {
    // Optimistic UI Update (Switch it instantly on screen so it feels fast)
    setFlows(flows.map(f => f.id === id ? { ...f, is_active: !currentStatus } : f))

    // Send update to Supabase
    const { error } = await supabase
      .from('automations')
      .update({ is_active: !currentStatus })
      .eq('id', id)

    // If error, revert the switch (optional safety)
    if (error) {
      console.error('Error updating automation:', error)
      setFlows(flows.map(f => f.id === id ? { ...f, is_active: currentStatus } : f))
    }
  }

  if (loading) return <div className="p-10 text-center text-slate-400 text-sm">Loading agents...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen">
      
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Automation</h1>
        <p className="text-slate-500 text-xs mt-1">Control your WhatsApp agents</p>
      </div>

      <div className="space-y-3 mb-24">
        {flows.map((flow) => {
          // Find the correct icon component
          const IconComponent = iconMap[flow.icon_name] || MessageCircle

          return (
            <div 
              key={flow.id}
              className={`
                relative p-4 rounded-[1.5rem] border transition-all duration-300
                ${flow.is_active 
                  ? 'bg-white border-blue-100 shadow-md shadow-blue-50/50' 
                  : 'bg-slate-50 border-slate-100 opacity-80'
                }
              `}
            >
              <div className="flex justify-between items-start mb-3">
                
                <div className="flex gap-3">
                  {/* Icon Box */}
                  <div className={`
                    p-2.5 rounded-xl flex items-center justify-center transition-colors
                    ${flow.is_active ? 'bg-primary text-primary-text' : 'bg-slate-200 text-slate-400'}
                  `}>
                    <IconComponent size={20} />
                  </div>
                  <div>
                    {/* Title & Desc */}
                    <h3 className={`font-bold text-sm ${flow.is_active ? 'text-slate-800' : 'text-slate-500'}`}>
                      {flow.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5 max-w-[140px] leading-relaxed">
                      {flow.description}
                    </p>
                  </div>
                </div>

                {/* Real Database Toggle */}
                <button 
                  onClick={() => toggleFlow(flow.id, flow.is_active)}
                  className={`
                    w-10 h-6 rounded-full flex items-center transition-all duration-300 px-0.5
                    ${flow.is_active ? 'bg-slate-900' : 'bg-slate-300'}
                  `}
                >
                  <div className={`
                    w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300
                    ${flow.is_active ? 'translate-x-4' : 'translate-x-0'}
                  `} />
                </button>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-100/50">
                <span className={`text-[10px] font-bold ${flow.is_active ? 'text-green-600' : 'text-slate-400'}`}>
                  {flow.is_active ? '● Active' : '○ Inactive'}
                </span>
                <span className="text-[10px] text-slate-400 font-medium">
                  {flow.stats}
                </span>
              </div>

            </div>
          )
        })}
      </div>

    </div>
  )
}