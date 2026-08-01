export function fixR2Url(url: string): string {
    if (!url) return '';
    if (url.startsWith('/api/fetch-image')) return url;
    return `/api/fetch-image?url=${encodeURIComponent(url)}`;
}

export function getVideoPosterUrl(asset: { id?: string; url?: string; metadata?: any } | null | undefined): string {
    if (!asset) return '';
    if (asset.metadata?.thumbnailUrl) {
        return fixR2Url(asset.metadata.thumbnailUrl);
    }
    if (asset.url) {
        const assetParam = asset.id ? `&assetId=${encodeURIComponent(asset.id)}` : '';
        return `/api/video/thumbnail?url=${encodeURIComponent(asset.url)}${assetParam}`;
    }
    return '';
}
