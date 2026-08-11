/**
 * Global in-memory data store for CRM & Analytics pages.
 * This persists across client-side navigation (SPA transitions) so pages
 * don't need to re-fetch on every visit — making the app feel native.
 *
 * Data is populated on first load and refreshed only when the user
 * explicitly clicks Refresh, or when a mutation (followup, stage change, etc.) occurs.
 */

type StoreListener = () => void

interface GlobalStoreState {
  // CRM data
  crm_leads: any[]
  crm_team: any[]
  crm_campaigns: any[]
  crm_properties: any[]
  crm_userId: string | null
  crm_targetUserId: string | null
  crm_role: string | null
  crm_lastFetchedAt: number | null

  // Analytics data
  analytics_leads: any[]
  analytics_chats: any[]
  analytics_messages: any[]
  analytics_team: any[]
  analytics_profile: any | null
  analytics_lastFetchedAt: number | null
  analytics_cacheKey: string | null
}

const initialState: GlobalStoreState = {
  crm_leads: [],
  crm_team: [],
  crm_campaigns: [],
  crm_properties: [],
  crm_userId: null,
  crm_targetUserId: null,
  crm_role: null,
  crm_lastFetchedAt: null,

  analytics_leads: [],
  analytics_chats: [],
  analytics_messages: [],
  analytics_team: [],
  analytics_profile: null,
  analytics_lastFetchedAt: null,
  analytics_cacheKey: null,
}

// The single global store instance (survives client-side navigations)
let store: GlobalStoreState = { ...initialState }
const listeners: Set<StoreListener> = new Set()

function notify() {
  listeners.forEach(fn => {
    try { fn() } catch (e) {}
  })
}

export function getGlobalStore(): GlobalStoreState {
  return store
}

export function setGlobalStore(partial: Partial<GlobalStoreState>) {
  store = { ...store, ...partial }
  notify()
}

export function subscribeGlobalStore(listener: StoreListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function resetGlobalStore(prefix?: 'crm' | 'analytics') {
  if (prefix === 'crm') {
    store = {
      ...store,
      crm_leads: [],
      crm_team: [],
      crm_campaigns: [],
      crm_properties: [],
      crm_userId: null,
      crm_targetUserId: null,
      crm_role: null,
      crm_lastFetchedAt: null,
    }
  } else if (prefix === 'analytics') {
    store = {
      ...store,
      analytics_leads: [],
      analytics_chats: [],
      analytics_messages: [],
      analytics_team: [],
      analytics_profile: null,
      analytics_lastFetchedAt: null,
      analytics_cacheKey: null,
    }
  } else {
    store = { ...initialState }
  }
  notify()
}

/** Check if cached data is still fresh (default: 5 min) */
export function isCacheFresh(lastFetchedAt: number | null, maxAgeMs = 5 * 60 * 1000): boolean {
  if (!lastFetchedAt) return false
  return (Date.now() - lastFetchedAt) < maxAgeMs
}
