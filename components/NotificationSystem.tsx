'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Bell, X, Check } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import Link from 'next/link'

type Notification = {
    id: string
    title: string
    message: string
    type: 'rivalry' | 'roi' | 'system' | 'lead'
    action_link?: string
    is_read: boolean
    created_at: string
}

export default function NotificationSystem() {
    const supabase = createClient()
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [isOpen, setIsOpen] = useState(false)
    const [unreadCount, setUnreadCount] = useState(0)

    useEffect(() => {
        fetchNotifications()
        subscribeToNotifications()
    }, [])

    const fetchNotifications = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(20)
        
        if (data) {
            setNotifications(data as Notification[])
            setUnreadCount(data.filter((n: any) => !n.is_read).length)
        }
    }

    const subscribeToNotifications = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const channel = supabase
            .channel('realtime-notifications')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${user.id}`
                },
                (payload) => {
                    const newNotif = payload.new as Notification
                    
                    // 1. Show Toast
                    toast(newNotif.title, {
                        description: newNotif.message,
                        action: newNotif.action_link ? {
                            label: 'View',
                            onClick: () => window.location.href = newNotif.action_link!
                        } : undefined,
                        duration: 5000,
                    })

                    // 2. Update List
                    setNotifications(prev => [newNotif, ...prev])
                    setUnreadCount(prev => prev + 1)
                }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }

    const markAsRead = async () => {
        if (unreadCount === 0) return
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', user.id)
            .eq('is_read', false)
        
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
        setUnreadCount(0)
    }

    return (
        <>
            <Toaster position="top-right" richColors />
            
            {/* Bell Icon in Header Area */}
            <div className="relative">
                <button 
                    onClick={() => { setIsOpen(!isOpen); markAsRead(); }}
                    className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
                >
                    <Bell size={20} className="text-slate-600" />
                    {unreadCount > 0 && (
                        <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                    )}
                </button>

                {/* Dropdown / Popover */}
                {isOpen && (
                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-[60] overflow-hidden animate-in slide-in-from-top-2 fade-in">
                        <div className="p-3 border-b border-slate-50 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notifications</h3>
                            <button onClick={() => setIsOpen(false)}><X size={14} className="text-slate-400"/></button>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="p-8 text-center text-slate-400 text-xs">No notifications yet.</div>
                            ) : (
                                notifications.map(notif => (
                                    <div key={notif.id} className={`p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${!notif.is_read ? 'bg-blue-50/30' : ''}`}>
                                        <div className="flex gap-3">
                                            <div className="mt-1">
                                                {notif.type === 'rivalry' && <span className="text-lg">🚀</span>}
                                                {notif.type === 'roi' && <span className="text-lg">💰</span>}
                                                {notif.type === 'lead' && <span className="text-lg">🔥</span>}
                                                {notif.type === 'system' && <span className="text-lg">🔔</span>}
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm font-bold text-slate-800 leading-tight mb-1">{notif.title}</p>
                                                <p className="text-xs text-slate-500 leading-relaxed mb-2">{notif.message}</p>
                                                {notif.action_link && (
                                                    <Link 
                                                        href={notif.action_link} 
                                                        onClick={() => setIsOpen(false)}
                                                        className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                                                    >
                                                        Take Action →
                                                    </Link>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-slate-300 whitespace-nowrap">
                                                {new Date(notif.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
    )
}