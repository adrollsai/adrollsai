const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3')
// Loaded via --env-file


const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT.replace('/' + process.env.R2_BUCKET_NAME, ''),
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
})


async function listFiles() {
    try {
        console.log("Listing files in R2 bucket:", process.env.R2_BUCKET_NAME)
        const data = await r2.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME
        }))

        
        if (data.Contents && data.Contents.length > 0) {
            console.log("\n=== MP4 VIDEOS IN R2 ===")
            // Filter by .mp4 and sort by LastModified descending
            const mp4s = data.Contents.filter(item => item.Key.toLowerCase().endsWith('.mp4'))
            mp4s.sort((a, b) => b.LastModified - a.LastModified)
            
            if (mp4s.length > 0) {
                mp4s.forEach(item => {
                    console.log(`Key: ${item.Key} | Size: ${(item.Size / 1024 / 1024).toFixed(2)} MB | Modified: ${item.LastModified}`)
                })
            } else {
                console.log("No MP4 files found in the bucket.")
            }
        } else {
            console.log("No files found in R2.")
        }

    } catch (err) {
        console.error("Error listing files:", err)
    }
}

listFiles()
