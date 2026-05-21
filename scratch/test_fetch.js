// Loaded via --env-file

const VIDEO_1 = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/bc63c065-9bcc-4793-bedc-f0960406425b/video_1778420845422.mp4"


async function testFetch() {
    try {
        console.log("Fetching video headers from:", VIDEO_1)
        const res = await fetch(VIDEO_1, { method: 'HEAD' })
        console.log("Status:", res.status)
        console.log("Headers:", Object.fromEntries(res.headers.entries()))
    } catch (e) {
        console.error("Error fetching:", e)
    }
}

testFetch()
