async function test() {
    const urls = [
        "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/9bbf6e51-283e-48d1-bbb4-8dc546cc74b2/stitched_1779879318682.mp4"
    ];
    for (const url of urls) {
        console.log("Testing full download:", url);
        const startTime = Date.now();
        const res = await fetch(url);
        console.log("Status:", res.status);
        const buffer = await res.arrayBuffer();
        console.log(`Downloaded ${buffer.byteLength} bytes in ${Date.now() - startTime}ms`);
    }
}
test().catch(console.error);
