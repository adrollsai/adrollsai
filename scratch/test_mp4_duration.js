const fs = require('fs');
const path = require('path');

function getMp4Duration(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.statSync(filePath);
    try {
        // Read first 256KB
        let buffer = Buffer.alloc(Math.min(256 * 1024, stats.size));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        
        let duration = parseBuffer(buffer);
        if (duration !== null) return duration;
        
        // If not found in first 256KB, it might be at the end. Read last 512KB
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
        // We look for 'mvhd' directly by scanning 4-byte boundaries
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        if (type === 'mvhd') {
            const version = buffer.readUInt8(offset + 8);
            let timescaleOffset = offset + 8 + 4; // Skip version and flags
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
        offset += 1; // Scan byte-by-byte for maximum robustness!
    }
    return null;
}

async function run() {
    const url = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/trimmed_ref_f6bfd3f76458e2243d4472da9e723855.mp4";
    console.log("Downloading video to test duration parsing...");
    const res = await fetch(url);
    const tempFile = path.join(__dirname, 'temp_test.mp4');
    fs.writeFileSync(tempFile, Buffer.from(await res.arrayBuffer()));
    
    console.log("Parsing duration from downloaded file...");
    const duration = getMp4Duration(tempFile);
    console.log("Parsed Duration:", duration, "seconds");
    
    fs.unlinkSync(tempFile);
}

run().catch(console.error);
