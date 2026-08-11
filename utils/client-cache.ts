/**
 * Client-side caching helpers for organizing, merging, and retrieving local storage cached data.
 * Supports both array caching (for lists of leads, assets, etc.) and value caching (for full page data objects).
 */

export function getLocalCache<T>(key: string): T[] {
    if (typeof window === 'undefined') return [];
    try {
        const cached = localStorage.getItem(key);
        if (!cached) return [];
        const parsed = JSON.parse(cached);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error(`[Cache] Error reading key "${key}":`, e);
        return [];
    }
}

export function setLocalCache<T>(key: string, data: T[]): void {
    if (typeof window === 'undefined') return;
    try {
        const safeArr = Array.isArray(data) ? data.slice(0, 200) : [];
        localStorage.setItem(key, JSON.stringify(safeArr));
    } catch (e) {
        console.warn(`[Cache] Error writing key "${key}":`, e);
    }
}

/**
 * Get a cached value (any type — objects, primitives, etc.) with optional staleness check.
 * @param key - localStorage key
 * @param maxAgeMs - optional max age in milliseconds. If set, returns null if cached data is older than this.
 * @returns The cached value or null if not found / stale.
 */
export function getCachedValue<T>(key: string, maxAgeMs?: number): T | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const envelope = JSON.parse(raw);
        if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
            // Legacy format or raw value — return as-is
            return envelope as T;
        }
        if (maxAgeMs && envelope.ts) {
            const age = Date.now() - envelope.ts;
            if (age > maxAgeMs) return null; // stale
        }
        return envelope.data as T;
    } catch (e) {
        console.error(`[Cache] Error reading value "${key}":`, e);
        return null;
    }
}

/**
 * Set a cached value (any type) with a timestamp for staleness checks.
 * Automatically trims large arrays and handles quota errors gracefully.
 * @param key - localStorage key
 * @param data - any serializable data
 */
export function setCachedValue<T>(key: string, data: T): void {
    if (typeof window === 'undefined') return;

    // Trim arrays inside the data to prevent quota overflow
    const trimmed = trimForStorage(data);

    const payload = JSON.stringify({ data: trimmed, ts: Date.now() });

    // If payload is over 2MB, don't even try — silently skip
    if (payload.length > 2 * 1024 * 1024) {
        console.warn(`[Cache] Skipping "${key}" — payload too large (${(payload.length / 1024).toFixed(0)}KB)`);
        return;
    }

    try {
        localStorage.setItem(key, payload);
    } catch (e) {
        // Quota exceeded — clear old caches and retry once
        console.warn(`[Cache] Quota exceeded for "${key}", clearing old caches and retrying...`);
        try {
            // Aggressively clear ALL app caches
            const prefixes = [
                'analytics_cache_', 'billing_cache', 'usage_cache', 'feed_',
                'qualifying_cache', 'plugins_cache', 'creation_properties_cache',
                'crm_cache_', 'crm_last_leads_cache', 'crm_properties_cache', 'crm_campaigns_cache',
                'assets_cache_', 'properties_cache_',
                'adrolls_orchestrator_cache', 'active_orchestrator_state'
            ];
            Object.keys(localStorage).forEach(k => {
                if (prefixes.some(p => k.startsWith(p)) && k !== key) {
                    localStorage.removeItem(k);
                }
            });
            // Retry after cleanup
            localStorage.setItem(key, payload);
        } catch (retryErr) {
            // Still failing — silently give up, app works without cache
            console.warn(`[Cache] Could not cache "${key}" even after cleanup. Skipping.`);
        }
    }
}

/**
 * Trim large arrays inside data objects to keep localStorage usage reasonable.
 * Keeps max 1500 items per array to prevent quota overflow while preserving full datasets.
 */
function trimForStorage(data: any): any {
    if (data === null || data === undefined) return data;
    if (Array.isArray(data)) {
        return data.slice(0, 1500);
    }
    if (typeof data === 'object') {
        const trimmed: any = {};
        for (const k of Object.keys(data)) {
            if (Array.isArray(data[k])) {
                trimmed[k] = data[k].slice(0, 1500);
            } else {
                trimmed[k] = data[k];
            }
        }
        return trimmed;
    }
    return data;
}

/**
 * Clear all cached values for a specific prefix.
 */
export function clearCacheByPrefix(prefix: string): void {
    if (typeof window === 'undefined') return;
    try {
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(prefix)) localStorage.removeItem(k);
        });
    } catch (e) {}
}

export function getMaxCreatedAt<T extends { created_at?: string }>(data: T[]): string | null {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    return data.reduce((max, item) => {
        if (!item || !item.created_at) return max;
        return (!max || item.created_at > max) ? item.created_at : max;
    }, null as string | null);
}

export function mergeCacheData<T extends { id: any; created_at?: string }>(
    cached: T[],
    fresh: T[]
): T[] {
    const safeCached = Array.isArray(cached) ? cached : [];
    const safeFresh = Array.isArray(fresh) ? fresh : [];
    if (safeCached.length === 0) return safeFresh;
    if (safeFresh.length === 0) return safeCached;

    const seenIds = new Set(safeFresh.map((item) => item.id));
    const uniqueCached = safeCached.filter((item) => item && item.id && !seenIds.has(item.id));
    const merged = [...safeFresh, ...uniqueCached];

    // Sort by created_at descending (newest first)
    return merged.sort((a, b) => {
        const timeA = a && a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b && b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
    });
}
