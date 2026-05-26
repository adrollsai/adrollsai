async function test() {
    const urls = [
        "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/1779522722462.png",
        "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/1779522722462.png"
    ];
    for (const url of urls) {
        console.log("Testing:", url);
        const res = await fetch(url);
        console.log("Status:", res.status);
    }
}
test().catch(console.error);
