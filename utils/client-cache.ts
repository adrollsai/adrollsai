/**
 * Client-side caching helpers for organizing, merging, and retrieving local storage cached data.
 */

export function getLocalCache<T>(key: string): T[] {
    if (typeof window === 'undefined') return [];
    try {
        const cached = localStorage.getItem(key);
        return cached ? JSON.parse(cached) : [];
    } catch (e) {
        console.error(`[Cache] Error reading key "${key}":`, e);
        return [];
    }
}

export function setLocalCache<T>(key: string, data: T[]): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error(`[Cache] Error writing key "${key}":`, e);
    }
}

export function getMaxCreatedAt<T extends { created_at?: string }>(data: T[]): string | null {
    if (!data || data.length === 0) return null;
    return data.reduce((max, item) => {
        if (!item.created_at) return max;
        return (!max || item.created_at > max) ? item.created_at : max;
    }, null as string | null);
}

export function mergeCacheData<T extends { id: any; created_at?: string }>(
    cached: T[],
    fresh: T[]
): T[] {
    if (!cached || cached.length === 0) return fresh;
    if (!fresh || fresh.length === 0) return cached;

    const seenIds = new Set(fresh.map((item) => item.id));
    const uniqueCached = cached.filter((item) => !seenIds.has(item.id));
    const merged = [...fresh, ...uniqueCached];

    // Sort by created_at descending (newest first)
    return merged.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
    });
}
