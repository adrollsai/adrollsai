async function test() {
    const urls = [
        "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/rendered/2f62a259-f23b-48ee-a920-c436f36eaa4b/video_1779424045684.mp4",
        "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/rendered/2f62a259-f23b-48ee-a920-c436f36eaa4b/video_1779424045684.mp4"
    ];
    for (const url of urls) {
        console.log("Testing:", url);
        const res = await fetch(url);
        console.log("Status:", res.status);
    }
}
test().catch(console.error);
