/**
 * Client-side caching helpers for organizing, merging, and retrieving local storage cached data.
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
        localStorage.setItem(key, JSON.stringify(Array.isArray(data) ? data : []));
    } catch (e) {
        console.error(`[Cache] Error writing key "${key}":`, e);
    }
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
