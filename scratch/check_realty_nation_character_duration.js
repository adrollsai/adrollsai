const fs = require('fs');
const path = require('path');

function getMp4Duration(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.statSync(filePath);
    try {
        let buffer = Buffer.alloc(Math.min(256 * 1024, stats.size));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        
        let duration = parseBuffer(buffer);
        if (duration !== null) return duration;
        
        if (stats.size > buffer.length) {
            const readSize = Math.min(512 * 1024, stats.size - buffer.length);
            buffer = Buffer.alloc(readSize);
            fs.readSync(fd, buffer, 0, buffer.length, stats.size - readSize);
            duration = parseBuffer(buffer);
            if (duration !== null) return duration;
        }
    } catch (e) {
        console.error("Failed to parse MP4 duration:", e);
    } finally {
        fs.closeSync(fd);
    }
    return null;
}

function parseBuffer(buffer) {
    let offset = 0;
    while (offset < buffer.length - 8) {
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'mvhd') {
            const version = buffer.readUInt8(offset + 8);
            let timescaleOffset = offset + 8 + 4;
            if (version === 1) {
                timescaleOffset += 16;
                const timescale = buffer.readUInt32BE(timescaleOffset);
                const durationHigh = buffer.readUInt32BE(timescaleOffset + 4);
                const durationLow = buffer.readUInt32BE(timescaleOffset + 8);
                const duration = (durationHigh * 4294967296) + durationLow;
                return duration / timescale;
            } else {
                timescaleOffset += 8;
                const timescale = buffer.readUInt32BE(timescaleOffset);
                const duration = buffer.readUInt32BE(timescaleOffset + 4);
                return duration / timescale;
            }
        }
        offset += 1;
    }
    return null;
}

async function checkUrl(url, label) {
    console.log(`Downloading ${label}...`);
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Failed to download ${label}: ${res.statusText}`);
            return;
        }
        const tempFile = path.join(__dirname, `temp_${label}.mp4`);
        fs.writeFileSync(tempFile, Buffer.from(await res.arrayBuffer()));
        
        const duration = getMp4Duration(tempFile);
        console.log(`${label} Duration:`, duration, "seconds");
        fs.unlinkSync(tempFile);
    } catch (e) {
        console.error(`Error checking ${label}:`, e.message);
    }
}

async function run() {
    const presenterUrl = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-c890a11f-84ce-4592-ab8f-8682927b1a9d-1780468110459.mp4";
    const videoAssetUrl = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d/1781854790292-videoad.mp4";
    
    await checkUrl(presenterUrl, "Presenter_Video");
    await checkUrl(videoAssetUrl, "Video_Asset");
}

run().catch(console.error);
