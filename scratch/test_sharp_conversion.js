const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function test() {
    try {
        console.log("Testing sharp import...");
        console.log("Sharp version/features:", sharp.versions);
        
        // Create a 100x100 white PNG image buffer using sharp
        const buffer = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        })
        .png()
        .toBuffer();
        
        console.log("PNG buffer generated. Size:", buffer.length);
        
        // Convert the PNG buffer to JPEG
        const jpegBuffer = await sharp(buffer)
            .jpeg({ quality: 90 })
            .toBuffer();
            
        console.log("JPEG buffer generated. Size:", jpegBuffer.length);
        console.log("Sharp test completed successfully!");
    } catch (e) {
        console.error("Sharp test failed:", e);
    }
}

test();
