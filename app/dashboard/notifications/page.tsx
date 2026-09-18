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
  Layers,
  Settings,
  Sliders,
  Mail,
  Smartphone,
  MessageSquare,
  Flame,
  UserCheck,
  UserPlus,
  Save,
  RotateCcw,
  Send,
  Check,
  CalendarCheck,
  Info
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import {
  NotificationTypeKey,
  NotificationChannel,
  UserNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  DEFAULT_ADMIN_PREFERENCES,
  DEFAULT_AGENT_PREFERENCES
} from '@/utils/notification-preferences'

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
  const initialTab = searchParams.get('tab') === 'preferences' ? 'preferences' : 'inbox'
  const supabase = createClient()

  // Navigation Tab: 'inbox' or 'preferences'
  const [activeTab, setActiveTab] = useState<'inbox' | 'preferences'>(initialTab)

  // Notifications State
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'reminder' | 'lead' | 'system'>('all')

  // Preferences State
  const [preferences, setPreferences] = useState<UserNotificationPreferences>(DEFAULT_AGENT_PREFERENCES)
  const [isAdmin, setIsAdmin] = useState(false)
  const [userRole, setUserRole] = useState<string>('agent')
  const [loadingPrefs, setLoadingPrefs] = useState(true)
  const [isSavingPrefs, setIsSavingPrefs] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Fetch Notifications
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

  // Fetch User Preferences
  const fetchPreferences = useCallback(async () => {
    setLoadingPrefs(true)
    try {
      const url = `/api/notifications/preferences${impersonateId ? `?impersonate=${impersonateId}` : ''}`
      const res = await fetch(url)
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to load preferences')

      setPreferences(data.preferences)
      setIsAdmin(Boolean(data.isAdmin))
      setUserRole(data.role || 'agent')
      setHasUnsavedChanges(false)
    } catch (err: any) {
      console.error('[Preferences Fetch Error]:', err)
      toast.error('Failed to load notification settings: ' + err.message)
    } finally {
      setLoadingPrefs(false)
    }
  }, [impersonateId])

  useEffect(() => {
    fetchNotifications()
    fetchPreferences()
  }, [fetchNotifications, fetchPreferences])

  // Handle Tab Switch
  const handleTabChange = (tab: 'inbox' | 'preferences') => {
    setActiveTab(tab)
    const newParams = new URLSearchParams(searchParams.toString())
    if (tab === 'preferences') {
      newParams.set('tab', 'preferences')
    } else {
      newParams.delete('tab')
    }
    const query = newParams.toString()
    router.replace(`/dashboard/notifications${query ? `?${query}` : ''}`)
  }

  // Toggle single preference channel
  const handleTogglePreference = (categoryKey: NotificationTypeKey, channel: NotificationChannel) => {
    // Safety check: Agents cannot toggle WhatsApp
    if (!isAdmin && channel === 'whatsapp') {
      toast.error('WhatsApp notifications are exclusively available to Admin accounts.')
      return
    }

    setPreferences(prev => {
      const currentCategory = prev[categoryKey] || { push: true, email: false, whatsapp: false }
      const updated = {
        ...prev,
        [categoryKey]: {
          ...currentCategory,
          [channel]: !currentCategory[channel]
        }
      }
      return updated
    })
    setHasUnsavedChanges(true)
  }

  // Save Preferences
  const handleSavePreferences = async () => {
    setIsSavingPrefs(true)
    try {
      const url = `/api/notifications/preferences${impersonateId ? `?impersonate=${impersonateId}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences })
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to save settings')

      setPreferences(data.preferences)
      setHasUnsavedChanges(false)
      toast.success('Notification preferences saved successfully!')
    } catch (err: any) {
      toast.error('Error saving settings: ' + err.message)
    } finally {
      setIsSavingPrefs(false)
    }
  }

  // Reset to Defaults
  const handleResetDefaults = async () => {
    if (!confirm('Reset all notification channels to recommended defaults?')) return
    setIsSavingPrefs(true)
    try {
      const url = `/api/notifications/preferences${impersonateId ? `?impersonate=${impersonateId}` : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true })
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to reset settings')

      setPreferences(data.preferences)
      setHasUnsavedChanges(false)
      toast.success('Preferences reset to defaults!')
    } catch (err: any) {
      toast.error('Failed to reset: ' + err.message)
    } finally {
      setIsSavingPrefs(false)
    }
  }

  // Send Test Alert
  const handleSendTestAlert = async () => {
    setIsSendingTest(true)
    try {
      const res = await fetch('/api/test-notification', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to trigger test notification')

      toast.success('Test notification dispatched! Check your device/notifications.')
      fetchNotifications()
    } catch (err: any) {
      toast.error('Test notification: ' + err.message)
    } finally {
      setIsSendingTest(false)
    }
  }

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

  // Relative time format
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

  // Filtered notifications list
  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === 'unread') return !n.is_read
    if (activeFilter === 'reminder') return n.type === 'reminder' || n.title.includes('Reminder') || n.title.includes('⏰')
    if (activeFilter === 'lead') return n.type.includes('lead') || n.type.includes('transfer') || n.type.includes('assign') || n.title.includes('Lead')
    if (activeFilter === 'system') return n.type === 'system' || n.type === 'general'
    return true
  })

  // Visual type config for notification alerts
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

  // Icon mapping for preferences category cards
  const getCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'UserPlus':
        return <UserPlus size={20} className="text-blue-600" />
      case 'UserCheck':
        return <UserCheck size={20} className="text-indigo-600" />
      case 'CalendarCheck':
        return <CalendarCheck size={20} className="text-emerald-600" />
      case 'Flame':
        return <Flame size={20} className="text-rose-600" />
      case 'Clock':
        return <Clock size={20} className="text-amber-600" />
      case 'Sparkles':
      default:
        return <Sparkles size={20} className="text-purple-600" />
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 min-h-screen pb-32 pt-16 relative">
      
      {/* Top Navigation & Header Row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 mt-2">
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => router.push(`/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`)}
            className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            title="Back to Profile"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                <span>Notifications & Alerts</span>
              </h1>
              {unreadCount > 0 && activeTab === 'inbox' && (
                <span className="px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-xs font-black shadow-xs animate-pulse">
                  {unreadCount} new
                </span>
              )}
              {isAdmin ? (
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-extrabold flex items-center gap-1">
                  <Shield size={12} className="text-indigo-600" />
                  <span>Admin Mode</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-extrabold flex items-center gap-1">
                  <User size={12} className="text-slate-500" />
                  <span>Agent Mode</span>
                </span>
              )}
            </div>
            <p className="text-slate-500 text-xs sm:text-sm font-medium mt-0.5">
              {activeTab === 'inbox'
                ? 'Review live lead events, team assignments, and system follow-up alerts.'
                : 'Select exactly which notifications you want and where they are delivered.'}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-2xl border border-slate-200/80 self-start md:self-auto">
          <button
            onClick={() => handleTabChange('inbox')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'inbox'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bell size={14} className={unreadCount > 0 ? 'text-blue-600' : ''} />
            <span>Alerts Feed</span>
            {unreadCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-black flex items-center justify-center">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => handleTabChange('preferences')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'preferences'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders size={14} className="text-blue-600" />
            <span>Notification Preferences</span>
            {hasUnsavedChanges && (
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Unsaved changes" />
            )}
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: NOTIFICATION PREFERENCES MATRIX                                      */}
      {/* ========================================================================= */}
      {activeTab === 'preferences' && (
        <div className="space-y-6">
          
          {/* Header Banner & Channel Legend */}
          <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white rounded-3xl p-6 sm:p-7 shadow-md border border-slate-800 relative overflow-hidden">
            <div className="relative z-10 max-w-3xl">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-400/30 flex items-center justify-center">
                  <Sliders size={16} />
                </div>
                <h2 className="text-lg sm:text-xl font-black tracking-tight text-white">
                  Multi-Channel Notification Dispatcher
                </h2>
              </div>
              <p className="text-slate-300 text-xs sm:text-sm font-medium leading-relaxed">
                Choose which channels you want alerts delivered to for each category.
                {!isAdmin && (
                  <span className="block mt-1 text-amber-300 font-semibold text-xs">
                    ℹ️ Note: WhatsApp notifications are restricted exclusively to Admins and are disabled for team agents.
                  </span>
                )}
              </p>

              {/* Channel Badges */}
              <div className="flex items-center gap-3 mt-4 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs border border-white/10 text-xs font-semibold">
                  <Smartphone size={14} className="text-blue-400" />
                  <span>In-App / Push</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-xs border border-white/10 text-xs font-semibold">
                  <Mail size={14} className="text-indigo-300" />
                  <span>Email Alerts</span>
                </div>
                {isAdmin ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
                    <MessageSquare size={14} className="text-emerald-400" />
                    <span>WhatsApp (Admin Exclusive)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-slate-400 text-xs font-semibold opacity-60">
                    <MessageSquare size={14} />
                    <span>WhatsApp (Admin Only)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Background Accent Deco */}
            <div className="absolute right-0 top-0 translate-x-1/3 -translate-y-1/3 w-72 h-72 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
          </div>

          {/* Quick Action Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">
                {hasUnsavedChanges ? (
                  <span className="text-amber-600 font-extrabold flex items-center gap-1.5">
                    <AlertCircle size={14} /> You have unsaved changes
                  </span>
                ) : (
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600" /> Settings up to date
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
              <button
                onClick={handleSendTestAlert}
                disabled={isSendingTest}
                className="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                title="Send a sample push notification to test connectivity"
              >
                <Send size={13} className={isSendingTest ? 'animate-spin text-blue-600' : 'text-slate-500'} />
                <span>{isSendingTest ? 'Sending test...' : 'Send Test Alert'}</span>
              </button>

              <button
                onClick={handleResetDefaults}
                disabled={isSavingPrefs}
                className="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
              >
                <RotateCcw size={13} className="text-slate-500" />
                <span>Reset Defaults</span>
              </button>

              <button
                onClick={handleSavePreferences}
                disabled={isSavingPrefs}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                {isSavingPrefs ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    <span>Save Preferences</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Preferences Category Cards */}
          {loadingPrefs ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3 bg-white rounded-3xl border border-slate-200/80 shadow-xs">
              <RefreshCw size={24} className="animate-spin text-blue-600" />
              <p className="text-xs font-bold text-slate-500">Loading your notification preferences...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {NOTIFICATION_CATEGORIES.map(category => {
                const setting = preferences[category.key] || { push: true, email: false, whatsapp: false }

                return (
                  <div
                    key={category.key}
                    className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/80 shadow-2xs hover:shadow-xs transition-shadow"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                      
                      {/* Left: Category Info */}
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0 shadow-2xs">
                          {getCategoryIcon(category.iconName)}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-base font-extrabold text-slate-900">
                              {category.title}
                            </h3>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                              {category.badgeText}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-medium leading-relaxed">
                            {category.description}
                          </p>
                        </div>
                      </div>

                      {/* Right: Channel Toggles Matrix */}
                      <div className="flex items-center gap-3 sm:gap-4 flex-wrap self-stretch lg:self-center justify-start lg:justify-end pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                        
                        {/* Channel 1: In-App Push */}
                        <div
                          onClick={() => handleTogglePreference(category.key, 'push')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer select-none ${
                            setting.push
                              ? 'bg-blue-50/70 border-blue-200 text-blue-900 shadow-2xs'
                              : 'bg-slate-50/60 border-slate-200 text-slate-400 hover:bg-slate-100'
                          }`}
                        >
                          <div className={`p-1.5 rounded-xl ${setting.push ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                            <Smartphone size={14} />
                          </div>
                          <div className="text-left">
                            <span className="block text-xs font-bold leading-tight">In-App Push</span>
                            <span className="block text-[10px] font-semibold opacity-75">
                              {setting.push ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer ml-1 pointer-events-none">
                            <input
                              type="checkbox"
                              checked={setting.push}
                              readOnly
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>

                        {/* Channel 2: Email */}
                        <div
                          onClick={() => handleTogglePreference(category.key, 'email')}
                          className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer select-none ${
                            setting.email
                              ? 'bg-indigo-50/70 border-indigo-200 text-indigo-900 shadow-2xs'
                              : 'bg-slate-50/60 border-slate-200 text-slate-400 hover:bg-slate-100'
                          }`}
                        >
                          <div className={`p-1.5 rounded-xl ${setting.email ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                            <Mail size={14} />
                          </div>
                          <div className="text-left">
                            <span className="block text-xs font-bold leading-tight">Email Alert</span>
                            <span className="block text-[10px] font-semibold opacity-75">
                              {setting.email ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer ml-1 pointer-events-none">
                            <input
                              type="checkbox"
                              checked={setting.email}
                              readOnly
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
                          </label>
                        </div>

                        {/* Channel 3: WhatsApp (ADMIN ONLY) */}
                        {isAdmin ? (
                          <div
                            onClick={() => handleTogglePreference(category.key, 'whatsapp')}
                            className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border transition-all cursor-pointer select-none ${
                              setting.whatsapp
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 shadow-2xs'
                                : 'bg-slate-50/60 border-slate-200 text-slate-400 hover:bg-slate-100'
                            }`}
                          >
                            <div className={`p-1.5 rounded-xl ${setting.whatsapp ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                              <MessageSquare size={14} />
                            </div>
                            <div className="text-left">
                              <span className="block text-xs font-bold leading-tight flex items-center gap-1">
                                <span>WhatsApp</span>
                                <span className="text-[9px] px-1 py-0.2 bg-emerald-200/80 text-emerald-800 rounded font-black">ADMIN</span>
                              </span>
                              <span className="block text-[10px] font-semibold opacity-75">
                                {setting.whatsapp ? 'Enabled' : 'Disabled'}
                              </span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer ml-1 pointer-events-none">
                              <input
                                type="checkbox"
                                checked={setting.whatsapp}
                                readOnly
                                className="sr-only peer"
                              />
                              <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                            </label>
                          </div>
                        ) : null}

                      </div>

                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Bottom Floating Save Button (Appears if changes made) */}
          {hasUnsavedChanges && (
            <div className="sticky bottom-6 z-20 flex justify-center">
              <div className="bg-slate-900/95 backdrop-blur-md text-white px-6 py-3.5 rounded-2xl shadow-xl border border-slate-700 flex items-center gap-4 animate-in fade-in slide-in-from-bottom-3 duration-200">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <AlertCircle size={15} className="text-amber-400" />
                  <span>You have unsaved preference changes</span>
                </span>
                <button
                  onClick={handleSavePreferences}
                  disabled={isSavingPrefs}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSavingPrefs ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  <span>Save Now</span>
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: INBOX & ALERTS FEED                                                */}
      {/* ========================================================================= */}
      {activeTab === 'inbox' && (
        <>
          {/* Controls Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            
            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar w-full sm:w-auto">
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
                  className={`px-3.5 py-2 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
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

            {/* Actions */}
            <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap">
              <button
                onClick={() => handleTabChange('preferences')}
                className="px-3.5 py-2 rounded-xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 text-slate-700 text-xs font-bold border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                title="Configure alert channels (Push, Email, WhatsApp)"
              >
                <Sliders size={13} className="text-blue-600" />
                <span>Configure Channels</span>
              </button>

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
                <button
                  onClick={() => handleTabChange('preferences')}
                  className="mt-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Sliders size={13} />
                  <span>Manage Notification Preferences</span>
                </button>
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
        </>
      )}

    </div>
  )
}
