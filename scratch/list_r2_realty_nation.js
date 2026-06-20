const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3')

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
        console.log("Listing files in R2 with prefix for Realty Nation...");
        const data = await r2.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: "adrolls-storage/generated/c890a11f-84ce-4592-ab8f-8682927b1a9d"
        }))

        if (data.Contents && data.Contents.length > 0) {
            console.log("Found files:");
            data.Contents.forEach(item => {
                console.log(`Key: ${item.Key} | Size: ${(item.Size / 1024 / 1024).toFixed(2)} MB | Modified: ${item.LastModified}`)
            })
        } else {
            console.log("No files found with this prefix.");
        }

        console.log("\nListing files in R2 library with prefix for Realty Nation...");
        const libData = await r2.send(new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: "adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d"
        }))

        if (libData.Contents && libData.Contents.length > 0) {
            console.log("Found library files:");
            libData.Contents.forEach(item => {
                console.log(`Key: ${item.Key} | Size: ${(item.Size / 1024 / 1024).toFixed(2)} MB | Modified: ${item.LastModified}`)
            })
        } else {
            console.log("No library files found with this prefix.");
        }

    } catch (err) {
        console.error("Error listing files:", err)
    }
}

listFiles()
