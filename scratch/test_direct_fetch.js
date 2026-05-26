async function test() {
    const url = "https://tempfile.aiquickdraw.com/seedance/1779776431690-t2lg35o7fqr.mp4";
    console.log("Testing fetch for:", url);
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    console.log("Status:", res.status);
    console.log("Headers:", Object.fromEntries(res.headers.entries()));
    const buffer = await res.arrayBuffer();
    console.log("Buffer size:", buffer.byteLength);
    const textSample = Buffer.from(buffer.slice(0, 200)).toString('utf8');
    console.log("Text sample (first 200 bytes):", textSample);
}
test().catch(console.error);
