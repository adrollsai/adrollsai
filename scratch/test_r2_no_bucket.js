async function test() {
    const url = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/scene_0_1779777178205.mp4";
    console.log("Testing fetch for R2 URL (without adrolls-storage):", url);
    const res = await fetch(url);
    console.log("Status:", res.status);
    console.log("Headers:", Object.fromEntries(res.headers.entries()));
    const buffer = await res.arrayBuffer();
    console.log("Buffer size:", buffer.byteLength);
}
test().catch(console.error);
