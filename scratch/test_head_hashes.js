const crypto = require('crypto');

async function getHash(url) {
    let hash = crypto.createHash('md5').update(url).digest('hex');
    try {
        const headRes = await fetch(url, { method: 'HEAD' });
        const contentLength = headRes.headers.get('content-length') || '';
        const lastModified = headRes.headers.get('last-modified') || '';
        const eTag = headRes.headers.get('etag') || '';
        hash = crypto.createHash('md5').update(`${url}_${contentLength}_${lastModified}_${eTag}`).digest('hex');
    } catch (e) {
        console.warn("HEAD request failed for", url, e.message);
    }
    return hash;
}

async function run() {
    const url1 = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-c890a11f-84ce-4592-ab8f-8682927b1a9d-1780468110459.mp4";
    const url2 = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d/1781854790292-videoad.mp4";
    
    console.log("Dynamic Hash 1:", await getHash(url1));
    console.log("Dynamic Hash 2:", await getHash(url2));
}

run();
