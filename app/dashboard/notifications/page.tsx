'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Bell,
  Clock,
  User,
  Shield,
  RefreshCw,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Filter,
  CheckCheck,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  Inbox,
  PhoneCall,
  Calendar,
  Layers
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'

type NotificationItem = {
  id: string
  user_id: string
  title: string
  message: string
  type: string
  action_link?: string | null
  is_read: boolean
  created_at: string
}

export default function NotificationsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'reminder' | 'lead' | 'system'>('all')

  const fetchNotifications = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) setIsRefreshing(true)
    else setLoading(true)

    try {
      const url = `/api/notifications${impersonateId ? `?impersonate=${impersonateId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to fetch notifications')

      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
      if (isManualRefresh) toast.success('Notifications updated')
    } catch (err: any) {
      console.error('[Notifications Page Fetch Error]:', err)
      toast.error('Failed to load notifications: ' + err.message)
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [impersonateId])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: id, impersonate: impersonateId })
      })
      if (!res.ok) throw new Error('Failed to update')

      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err: any) {
      console.error('[Mark As Read Error]:', err)
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true, impersonate: impersonateId })
      })
      if (!res.ok) throw new Error('Failed to mark all as read')

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
      toast.success('All notifications marked as read')
    } catch (err: any) {
      toast.error('Error: ' + err.message)
    }
  }

  const handleDeleteNotification = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    try {
      const res = await fetch(`/api/notifications?id=${id}${impersonateId ? `&impersonate=${impersonateId}` : ''}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete')

      const target = notifications.find(n => n.id === id)
      setNotifications(prev => prev.filter(n => n.id !== id))
      if (target && !target.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
      toast.success('Notification removed')
    } catch (err: any) {
      toast.error('Error: ' + err.message)
    }
  }

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear all notifications?')) return

    try {
      const res = await fetch(`/api/notifications?clearAll=true${impersonateId ? `&impersonate=${impersonateId}` : ''}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to clear notifications')

      setNotifications([])
      setUnreadCount(0)
      toast.success('All notifications cleared')
    } catch (err: any) {
      toast.error('Error: ' + err.message)
    }
  }

  const handleNavigateAction = (item: NotificationItem) => {
    if (!item.is_read) {
      handleMarkAsRead(item.id)
    }

    if (item.action_link) {
      let dest = item.action_link
      if (impersonateId && !dest.includes('impersonate=')) {
        dest += (dest.includes('?') ? '&' : '?') + `impersonate=${impersonateId}`
      }
      router.push(dest)
    }
  }

  // Format friendly relative time
  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffSec = Math.floor(diffMs / 1000)
      const diffMin = Math.floor(diffSec / 60)
      const diffHours = Math.floor(diffMin / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffSec < 60) return 'Just now'
      if (diffMin < 60) return `${diffMin}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays}d ago`

      return d.toLocaleDateString([], {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    } catch (e) {
      return dateStr
    }
  }

  // Filtered list
  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === 'unread') return !n.is_read
    if (activeFilter === 'reminder') return n.type === 'reminder' || n.title.includes('Reminder') || n.title.includes('⏰')
    if (activeFilter === 'lead') return n.type.includes('lead') || n.type.includes('transfer') || n.type.includes('assign') || n.title.includes('Lead')
    if (activeFilter === 'system') return n.type === 'system' || n.type === 'general'
    return true
  })

  // Get icon and badge config based on notification type
  const getTypeConfig = (item: NotificationItem) => {
    const isReminder = item.type === 'reminder' || item.title.includes('Reminder') || item.title.includes('⏰')
    const isLead = item.type.includes('lead') || item.type.includes('transfer') || item.type.includes('assign') || item.title.includes('Lead')

    if (isReminder) {
      return {
        icon: <Clock size={18} className="text-amber-600" />,
        badgeText: 'Reminder',
        badgeBg: 'bg-amber-100/80 text-amber-800 border-amber-200',
        avatarBg: 'bg-amber-50 border-amber-200/80 text-amber-600'
      }
    }

    if (isLead) {
      return {
        icon: <User size={18} className="text-blue-600" />,
        badgeText: 'Lead Alert',
        badgeBg: 'bg-blue-100/80 text-blue-800 border-blue-200',
        avatarBg: 'bg-blue-50 border-blue-200/80 text-blue-600'
      }
    }

    return {
      icon: <Sparkles size={18} className="text-purple-600" />,
      badgeText: 'System Alert',
      badgeBg: 'bg-purple-100/80 text-purple-800 border-purple-200',
      avatarBg: 'bg-purple-50 border-purple-200/80 text-purple-600'
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen pb-32 pt-16 relative">
      
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 mt-2">
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
            className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            title="Back to Profile"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Notifications & Alerts</span>
              </h1>
              {unreadCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-xs font-black shadow-xs animate-pulse">
                  {unreadCount} new
                </span>
              )}
            </div>
            <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
              Track lead follow-up reminders, team assignments, and real-time updates.
            </p>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold border border-blue-200/80 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <CheckCheck size={14} />
              <span>Mark all read</span>
            </button>
          )}

          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-3 py-2 rounded-xl bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-600 text-xs font-bold border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <Trash2 size={14} />
              <span>Clear all</span>
            </button>
          )}

          <button
            onClick={() => fetchNotifications(true)}
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            title="Refresh notifications"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 no-scrollbar">
        {[
          { id: 'all', label: 'All Alerts', count: notifications.length },
          { id: 'unread', label: 'Unread', count: unreadCount },
          { id: 'reminder', label: '⏰ Reminders', count: notifications.filter(n => n.type === 'reminder' || n.title.includes('Reminder') || n.title.includes('⏰')).length },
          { id: 'lead', label: '👤 Leads', count: notifications.filter(n => n.type.includes('lead') || n.type.includes('transfer') || n.type.includes('assign') || n.title.includes('Lead')).length },
          { id: 'system', label: '⚡ System', count: notifications.filter(n => n.type === 'system' || n.type === 'general').length }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id as any)}
            className={`px-4 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
              activeFilter === tab.id
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              activeFilter === tab.id
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Notifications List */}
      <div className="space-y-3">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
            <RefreshCw size={24} className="animate-spin text-blue-600" />
            <p className="text-xs font-bold text-slate-500">Loading your alerts & reminders...</p>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center p-6 bg-white rounded-3xl border border-slate-200/80 shadow-xs space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <Inbox size={26} />
            </div>
            <h3 className="text-base font-extrabold text-slate-900">No notifications in this filter</h3>
            <p className="text-slate-500 text-xs font-medium max-w-sm">
              You are completely caught up! New lead follow-up reminders and team updates will appear here automatically.
            </p>
          </div>
        ) : (
          filteredNotifications.map((item) => {
            const typeCfg = getTypeConfig(item)

            return (
              <div
                key={item.id}
                onClick={() => handleNavigateAction(item)}
                className={`group relative p-4 sm:p-5 rounded-3xl border transition-all cursor-pointer flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                  !item.is_read
                    ? 'bg-gradient-to-r from-blue-50/40 via-white to-white border-blue-200/90 shadow-sm hover:shadow-md hover:border-blue-300'
                    : 'bg-white border-slate-200/80 hover:border-slate-300 shadow-2xs hover:shadow-xs'
                }`}
              >
                {/* Left Section: Icon & Content */}
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  {/* Avatar Icon */}
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border shrink-0 ${typeCfg.avatarBg}`}>
                    {typeCfg.icon}
                  </div>

                  {/* Text Details */}
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider border ${typeCfg.badgeBg}`}>
                        {typeCfg.badgeText}
                      </span>
                      {!item.is_read && (
                        <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" />
                      )}
                      <span className="text-[11px] font-semibold text-slate-400">
                        {formatTime(item.created_at)}
                      </span>
                    </div>

                    <h4 className={`text-sm font-extrabold leading-snug break-words ${!item.is_read ? 'text-slate-900' : 'text-slate-800'}`}>
                      {item.title}
                    </h4>

                    {item.message && (
                      <p className="text-xs text-slate-600 font-medium leading-relaxed whitespace-pre-wrap break-words">
                        {item.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right Section: Action Controls */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  {item.action_link && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleNavigateAction(item)
                      }}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200/80 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <span>View</span>
                      <ExternalLink size={12} />
                    </button>
                  )}

                  {!item.is_read && (
                    <button
                      type="button"
                      onClick={(e) => handleMarkAsRead(item.id, e)}
                      className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors cursor-pointer"
                      title="Mark as read"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={(e) => handleDeleteNotification(item.id, e)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
                    title="Delete notification"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
