import { getPropertyTags } from './property-tags';

export function getPropertyDisplayLabel(p: any): string {
    if (!p) return '';
    const title = p.title || 'Untitled Product';
    
    // Extract tags using standard helper + configuration parsing fallback
    let tags: string[] = getPropertyTags(p);
    if (tags.length === 0 && p.configurations) {
        try {
            const parsed = typeof p.configurations === 'string' ? JSON.parse(p.configurations) : p.configurations;
            if (Array.isArray(parsed)) {
                tags = parsed.map((c: any) => c.name || c.title || '').filter(Boolean);
            }
        } catch(e) {}
    }

    const details: string[] = [];
    if (p.address && p.address.trim()) {
        details.push(p.address.trim());
    }
    if (tags.length > 0) {
        details.push(`Tags: ${tags.join(', ')}`);
    }
    if (p.property_type && p.property_type.trim() && p.property_type.toLowerCase() !== 'generic') {
        details.push(p.property_type.trim());
    }
    if (p.price && p.price.trim()) {
        details.push(p.price.trim());
    }

    if (details.length > 0) {
        return `${title} (${details.join(' • ')})`;
    }
    return title;
}
