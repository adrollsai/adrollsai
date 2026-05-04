'use client'

import React, { useEffect, useState } from 'react'
import { Sparkles, ArrowRight, CheckCircle2, TrendingUp, Target, Rocket, Zap, Flame, BarChart3, Activity, Trophy, Calendar } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

interface Mission {
  id: string
  title: string
  description: string
  completed: boolean
  actionUrl: string
  icon: React.ElementType
  points: number
}

export default function MentorHub() {
  const supabase = createClient()
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState('')
  const [streak, setStreak] = useState(5) // Example streak
  const [growthIndex, setGrowthIndex] = useState(72)

  useEffect(() => {
    async function fetchMissions() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', user.id).single()
      setUserName(profile?.business_name || 'Founder')

      const { count: propCount } = await supabase.from('properties').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      const { count: assetCount } = await supabase.from('assets').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      const { count: leadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', user.id)

      const missionList: Mission[] = [
        {
          id: '1',
          title: 'Offer Optimization',
          description: propCount && propCount > 0 ? 'Core offer analyzed and deployed.' : 'Define your high-value core offer to unlock scaling.',
          completed: !!(propCount && propCount > 0),
          actionUrl: '/dashboard',
          icon: Target,
          points: 100
        },
        {
          id: '2',
          title: 'Ad Deployment',
          description: assetCount && assetCount > 0 ? 'AI creatives generating impressions.' : 'Launch your daily AI-optimized lead cycle.',
          completed: !!(assetCount && assetCount > 0),
          actionUrl: '/dashboard/ads',
          icon: Zap,
          points: 200
        },
        {
          id: '3',
          title: 'Pipeline Management',
          description: leadCount && leadCount > 0 ? 'Leads syncing in real-time.' : 'Connect your lead flows to prevent drop-off.',
          completed: !!(leadCount && leadCount > 0),
          actionUrl: '/dashboard/crm',
          icon: TrendingUp,
          points: 150
        }
      ]

      setMissions(missionList)
      setLoading(false)
      
      const completedCount = missionList.filter(m => m.completed).length
      setGrowthIndex(40 + (completedCount * 20))
    }

    fetchMissions()
  }, [supabase])

  return (
    <div className="premium-card p-8 sm:p-10 mb-12 relative overflow-hidden group">
      
      {/* Background Accents */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />
      
      <div className="relative z-10 flex flex-col lg:flex-row gap-12">
        
        {/* Left Side: Stats & Character */}
        <div className="flex flex-col items-center lg:items-start text-center lg:text-left gap-6 lg:min-w-[300px]">
           <div className="relative">
              <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-[2.5rem] bg-zinc-800 border border-white/10 flex items-center justify-center text-6xl shadow-2xl animate-float">
                 🐶
              </div>
              <div className="absolute -bottom-2 -right-2 bg-brand-green p-2.5 rounded-2xl shadow-xl border-2 border-zinc-950">
                 <Trophy size={18} className="text-white" />
              </div>
           </div>
           
           <div>
              <h2 className="text-3xl font-black text-white tracking-tight mb-2">Hello, {userName}</h2>
              <div className="flex items-center justify-center lg:justify-start gap-3">
                 <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 rounded-lg border border-white/5">
                    <Flame size={14} className="text-brand-amber fill-brand-amber" />
                    <span className="text-xs font-black text-white">{streak} Day Streak</span>
                 </div>
                 <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 rounded-lg border border-white/5">
                    <Sparkles size={14} className="text-brand-purple" />
                    <span className="text-xs font-black text-white">Elite Status</span>
                 </div>
              </div>
           </div>
        </div>

        {/* Right Side: Growth Index & Missions */}
        <div className="flex-1 w-full space-y-10">
           
           {/* Growth Index Bar */}
           <div className="space-y-4">
              <div className="flex justify-between items-end">
                 <div className="flex items-center gap-2">
                    <BarChart3 size={18} className="text-primary" />
                    <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Business Growth Index</span>
                 </div>
                 <span className="text-2xl font-black text-white">{growthIndex}%</span>
              </div>
              <div className="h-3 w-full bg-zinc-800 rounded-full overflow-hidden p-0.5 border border-white/5">
                 <div 
                   className="h-full bg-primary transition-all duration-1000 ease-out rounded-full relative" 
                   style={{ width: `${growthIndex}%` }}
                 >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/20 animate-pulse" />
                 </div>
              </div>
              <p className="text-[11px] text-zinc-500 font-bold leading-relaxed">
                 You are currently outperforming <span className="text-white">82% of similar businesses</span> in your sector. Complete today&apos;s missions to maintain elite velocity.
              </p>
           </div>

           {/* Mission Row */}
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {missions.map((mission) => (
                <a 
                  key={mission.id}
                  href={mission.actionUrl}
                  className={`group relative p-5 rounded-[2rem] transition-all duration-300 border ${mission.completed ? 'bg-zinc-800/30 border-white/5 opacity-60' : 'bg-zinc-900 hover:bg-zinc-800 border-white/10'}`}
                >
                   <div className="flex items-center justify-between mb-4">
                      <div className={`p-2.5 rounded-xl ${mission.completed ? 'bg-zinc-700/50' : 'bg-primary/10'}`}>
                         <mission.icon size={18} className={mission.completed ? 'text-zinc-500' : 'text-primary'} />
                      </div>
                      {mission.completed ? <CheckCircle2 size={18} className="text-brand-green" /> : <ArrowRight size={18} className="text-zinc-600 group-hover:text-white group-hover:translate-x-1 transition-all" />}
                   </div>
                   <h4 className={`text-xs font-black uppercase tracking-tighter mb-1 ${mission.completed ? 'text-zinc-500' : 'text-white'}`}>{mission.title}</h4>
                   <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-zinc-600">Reward: {mission.points} XP</span>
                   </div>
                </a>
              ))}
           </div>

        </div>
      </div>
    </div>
  )
}
