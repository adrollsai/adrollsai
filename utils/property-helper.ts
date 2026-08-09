import { getPropertyTags } from './property-tags';

export function getPropertyDisplayLabel(p: any): string {
    if (!p) return '';
    const title = p.title || p.name || 'Untitled Product';
    
    // Extract tags using standard helper + configuration parsing fallback
    let tags: string[] = getPropertyTags(p);
    if (tags.length === 0 && p.configurations) {
        try {
            const parsed = typeof p.configurations === 'string' ? JSON.parse(p.configurations) : p.configurations;
            if (Array.isArray(parsed?.tags)) {
                tags = parsed.tags.map((c: any) => String(c).trim()).filter(Boolean);
            } else if (Array.isArray(parsed)) {
                tags = parsed.map((c: any) => c.name || c.title || '').filter(Boolean);
            }
        } catch(e) {}
    }

    if (tags.length > 0) {
        return `${title} [Tags: ${tags.join(', ')}]`;
    }
    return title;
}
