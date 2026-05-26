const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Load environment variables manually
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const kieApiKey = process.env.KIE_API_KEY;

const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT ? process.env.R2_ENDPOINT.replace(/\/adrolls-storage$/, '') : `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'adrolls-storage';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev';

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase credentials in .env.local!");
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function extractVideoUrl(checkData) {
    if (!checkData) return null;
    
    const result = checkData.result || checkData.data?.result || checkData.data;
    
    if (result) {
        // 1. Direct URL fields
        const url = result.video_url || 
                    result.videoUrl || 
                    result.output_url || 
                    result.outputUrl || 
                    result.url || 
                    result.imageUrl || 
                    result.image_url;

        if (url && typeof url === 'string' && url.startsWith('http')) {
            return url;
        }

        // 2. Prioritized callback formats (Arrays of URLs)
        const urls = result.videoUrls || 
                     result.resultUrls || 
                     result.result_urls || 
                     result.fullResultUrls || 
                     result.full_result_urls;
                     
        if (Array.isArray(urls) && urls.length > 0 && typeof urls[0] === 'string' && urls[0].startsWith('http')) {
            return urls[0];
        }
    }

    // 3. Fallback to resultJson field
    const resultJson = checkData.resultJson || checkData.data?.resultJson;
    if (resultJson) {
        try {
            const parsed = JSON.parse(resultJson);
            const parsedUrls = parsed.resultUrls || parsed.result_urls || parsed.fullResultUrls || parsed.full_result_urls || [parsed.url];
            const firstUrl = Array.isArray(parsedUrls) ? parsedUrls[0] : parsedUrls;
            if (firstUrl && typeof firstUrl === 'string' && firstUrl.startsWith('http')) {
                return firstUrl;
            }
        } catch (e) {
            console.error("[Sync] Error parsing resultJson:", e);
        }
    }

    // 4. Recursive search fallback: Find the first substring that looks like a video URL
    try {
        const jsonStr = JSON.stringify(checkData);
        const matches = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|mov|avi|webm)[^"]*)"/i);
        if (matches && matches.length > 1) {
            return matches[1];
        }
        
        // General URL search as a final resort
        const generalMatches = jsonStr.match(/"(https?:\/\/[^"]+)"/g);
        if (generalMatches) {
            for (const match of generalMatches) {
                const url = match.replace(/"/g, '');
                if (url.includes('.mp4') || url.includes('/generated/') || url.includes('kie.ai')) {
                    return url;
                }
            }
        }
    } catch (e) {
        console.error("[Sync] Regex URL extraction error:", e);
    }

    return null;
}

async function run() {
    const args = process.argv.slice(2);
    if (args.length >= 2) {
        const assetId = args[0];
        const taskIds = args.slice(1);
        console.log(`\n==========================================`);
        console.log(`MANUAL RECOVERY MODE`);
        console.log(`Target Asset ID: ${assetId}`);
        console.log(`Task IDs provided: ${taskIds.join(', ')}`);
        console.log(`==========================================\n`);
        
        await manualStitch(assetId, taskIds);
        return;
    }

    console.log("-----------------------------------------");
    console.log("Checking active video tasks in Supabase...");
    console.log("-----------------------------------------");

    const { data: activeTasks, error } = await supabaseAdmin
        .from('video_tasks')
        .select('*');

    if (error) {
        console.error("Error fetching tasks:", error);
        return;
    }

    if (!activeTasks || activeTasks.length === 0) {
        console.log("No active video tasks found in video_tasks table.");
        return;
    }

    console.log(`Found ${activeTasks.length} active scene task(s). Checking status on Kie.ai...`);

    // Group tasks by asset_id
    const groups = {};
    for (const task of activeTasks) {
        if (!groups[task.asset_id]) {
            groups[task.asset_id] = [];
        }
        groups[task.asset_id].push(task);
    }

    for (const assetId of Object.keys(groups)) {
        console.log(`\nChecking Group for Asset ID: ${assetId}`);
        const tasks = groups[assetId];
        let allCompleted = true;
        const completeScenes = [];

        for (const task of tasks) {
            console.log(`- Scene ${task.current_index + 1} (Task ID: ${task.last_task_id}, status: ${task.status})`);
            
            // Check status on Kie.ai
            try {
                const checkRes = await global.fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${task.last_task_id}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${kieApiKey}` }
                });
                
                if (!checkRes.ok) {
                    console.error(`  Failed to query Kie.ai for scene ${task.current_index + 1}: ${checkRes.statusText}`);
                    allCompleted = false;
                    continue;
                }
                
                const checkData = await checkRes.json();
                const status = checkData.status || checkData.data?.status || checkData.data?.state;
                console.log(`  Kie.ai Status: ${status}`);
                
                if (status === 'succeeded' || status === 'completed' || status === 'success') {
                    let resultUrl = extractVideoUrl(checkData);

                    if (resultUrl && typeof resultUrl === 'string' && resultUrl.startsWith('http')) {
                        console.log(`  Scene ${task.current_index + 1} is READY: ${resultUrl}`);
                        
                        // Persist to R2
                        let sceneR2Url = resultUrl;
                        try {
                            const videoRes = await global.fetch(resultUrl);
                            const buffer = Buffer.from(await videoRes.arrayBuffer());
                            const fileName = `generated/${task.user_id}/scene_${task.current_index}_${Date.now()}.mp4`;
                            
                            await r2.send(new PutObjectCommand({
                                Bucket: R2_BUCKET,
                                Key: fileName,
                                Body: buffer,
                                ContentType: 'video/mp4'
                            }));
                            
                            sceneR2Url = `${R2_PUBLIC_URL}/${fileName}`;
                            console.log(`  Persisted to R2: ${sceneR2Url}`);
                        } catch (r2Err) {
                            console.error(`  R2 persistence failed: ${r2Err.message}`);
                        }

                        // Update task status in DB
                        await supabaseAdmin
                            .from('video_tasks')
                            .update({
                                status: 'Completed',
                                last_successful_task_id: sceneR2Url
                            })
                            .eq('id', task.id);
                        
                        completeScenes.push({
                            current_index: task.current_index,
                            url: resultUrl // Download directly from Kie.ai for local stitching
                        });
                    } else {
                        console.log(`  Scene ${task.current_index + 1} succeeded but no URL found in recordInfo payload.`);
                        allCompleted = false;
                    }
                } else if (task.status === 'Completed' && task.last_successful_task_id) {
                    console.log(`  Scene ${task.current_index + 1} is already Completed in DB: ${task.last_successful_task_id}`);
                    completeScenes.push({
                        current_index: task.current_index,
                        url: task.last_successful_task_id
                    });
                } else {
                    console.log(`  Scene ${task.current_index + 1} is NOT ready yet.`);
                    allCompleted = false;
                }
            } catch (err) {
                console.error(`  Error checking task ${task.last_task_id}:`, err.message);
                allCompleted = false;
            }
        }

        // If all scenes for this asset are ready, stitch them!
        if (allCompleted && completeScenes.length > 0) {
            console.log(`\n🎉 All scenes for asset ${assetId} are COMPLETED! Commencing stitching...`);
            completeScenes.sort((a, b) => a.current_index - b.current_index);
            
            const tempDir = path.join(os.tmpdir(), `stitch_${assetId}`);
            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                const localFiles = [];
                for (let idx = 0; idx < completeScenes.length; idx++) {
                    const scene = completeScenes[idx];
                    const localPath = path.join(tempDir, `scene_${idx}.mp4`);
                    console.log(`Downloading scene ${idx + 1} from ${scene.url}...`);
                    const res = await global.fetch(scene.url);
                    const buffer = Buffer.from(await res.arrayBuffer());
                    fs.writeFileSync(localPath, buffer);
                    localFiles.push(localPath);
                }

                // Generate concat.txt
                const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
                const concatTxtPath = path.join(tempDir, 'concat.txt');
                fs.writeFileSync(concatTxtPath, concatContent);

                const outputPath = path.join(tempDir, 'stitched.mp4');
                const ffmpegBinary = path.join(
                    process.cwd(), 
                    'node_modules/ffmpeg-static', 
                    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
                );

                const cmd = `"${ffmpegBinary}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;
                console.log(`Executing FFmpeg: ${cmd}`);

                await new Promise((resolve, reject) => {
                    exec(cmd, (execErr, stdout, stderr) => {
                        if (execErr) {
                            console.error(`FFmpeg error:`, execErr);
                            reject(execErr);
                        } else {
                            console.log(`Stitching complete! Output saved.`);
                            resolve();
                        }
                    });
                });

                // Upload to R2
                console.log("Uploading stitched video to R2...");
                const stitchedBuffer = fs.readFileSync(outputPath);
                const finalFileName = `generated/${tasks[0].user_id}/stitched_${Date.now()}.mp4`;
                
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: finalFileName,
                    Body: stitchedBuffer,
                    ContentType: 'video/mp4'
                }));
                
                const persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
                console.log(`Final Stitched URL on R2: ${persistedUrl}`);

                // Update asset record in Supabase
                console.log("Updating Asset record in Supabase...");
                const { error: updateErr } = await supabaseAdmin
                    .from('assets')
                    .update({
                        url: persistedUrl,
                        status: 'Draft' // turn placeholder card into active asset
                    })
                    .eq('id', assetId);

                if (updateErr) throw updateErr;

                // Clean up database task records
                console.log("Deleting task records from video_tasks...");
                await supabaseAdmin.from('video_tasks').delete().eq('asset_id', assetId);

                console.log(`\n✅ SUCCESSFULLY retrieved and stitched video for asset ${assetId}!`);

            } catch (stitchErr) {
                console.error("Stitching or database updates failed:", stitchErr.message);
            } finally {
                // Cleanup temp dir
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                } catch (e) {}
            }
        } else {
            console.log(`\n⏳ Some scenes are still rendering or could not be verified. Not ready for stitching yet.`);
        }
    }
}

async function manualStitch(assetId, taskIds) {
    // 1. Fetch target asset
    const { data: assetData, error: assetErr } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .single();
    
    if (assetErr || !assetData) {
        console.error(`❌ Error finding target asset ${assetId}:`, assetErr?.message || "Asset not found");
        return;
    }
    const userId = assetData.user_id;
    console.log(`Found asset for User ID: ${userId}`);

    // 2. Fetch all completed scene clips from Kie.ai in parallel/sequence
    const completeScenes = [];
    for (let i = 0; i < taskIds.length; i++) {
        const taskId = taskIds[i];
        console.log(`Querying status for Scene ${i + 1} (Kie Task ID: ${taskId})...`);
        
        try {
            const checkRes = await global.fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${kieApiKey}` }
            });
            
            if (!checkRes.ok) {
                console.error(`❌ Failed to query Kie.ai for taskId ${taskId}: ${checkRes.statusText}`);
                return;
            }
            
            const checkData = await checkRes.json();
            const status = checkData.status || checkData.data?.status || checkData.data?.state;
            console.log(`  Kie.ai Status: ${status}`);
            
            if (status === 'succeeded' || status === 'completed' || status === 'success') {
                let resultUrl = extractVideoUrl(checkData);

                if (resultUrl && typeof resultUrl === 'string' && resultUrl.startsWith('http')) {
                    console.log(`  Scene ${i + 1} is READY: ${resultUrl}`);
                    
                    // Persist to R2
                    let sceneR2Url = resultUrl;
                    try {
                        const videoRes = await global.fetch(resultUrl);
                        const buffer = Buffer.from(await videoRes.arrayBuffer());
                        const fileName = `generated/${userId}/scene_${i}_${Date.now()}.mp4`;
                        
                        await r2.send(new PutObjectCommand({
                            Bucket: R2_BUCKET,
                            Key: fileName,
                            Body: buffer,
                            ContentType: 'video/mp4'
                        }));
                        
                        sceneR2Url = `${R2_PUBLIC_URL}/${fileName}`;
                        console.log(`  Persisted Scene to R2: ${sceneR2Url}`);
                    } catch (r2Err) {
                        console.error(`  R2 persistence failed for Scene ${i + 1}, using original Kie URL instead: ${r2Err.message}`);
                    }
                    
                    completeScenes.push({
                        current_index: i,
                        url: resultUrl // Download directly from Kie.ai for local stitching
                    });
                } else {
                    console.error(`❌ Scene ${i + 1} succeeded but no URL found in recordInfo payload:`, JSON.stringify(checkData));
                    return;
                }
            } else {
                console.error(`❌ Scene ${i + 1} is not succeeded (Status: ${status}). Cannot stitch.`);
                return;
            }
        } catch (err) {
            console.error(`❌ Error checking task ${taskId}:`, err.message);
            return;
        }
    }

    // 3. Stitch the scenes!
    console.log(`\n🎉 All ${completeScenes.length} scenes fetched successfully! Commencing stitching...`);
    completeScenes.sort((a, b) => a.current_index - b.current_index);
    
    const tempDir = path.join(os.tmpdir(), `stitch_${assetId}`);
    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const localFiles = [];
        for (let idx = 0; idx < completeScenes.length; idx++) {
            const scene = completeScenes[idx];
            const localPath = path.join(tempDir, `scene_${idx}.mp4`);
            console.log(`Downloading scene ${idx + 1} from ${scene.url}...`);
            const res = await global.fetch(scene.url);
            const buffer = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(localPath, buffer);
            localFiles.push(localPath);
        }

        // Generate concat.txt
        const concatContent = localFiles.map(file => `file '${file.replace(/\\/g, '/')}'`).join('\n');
        const concatTxtPath = path.join(tempDir, 'concat.txt');
        fs.writeFileSync(concatTxtPath, concatContent);

        const outputPath = path.join(tempDir, 'stitched.mp4');
        const ffmpegBinary = path.join(
            process.cwd(), 
            'node_modules/ffmpeg-static', 
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );

        const cmd = `"${ffmpegBinary}" -nostdin -y -f concat -safe 0 -i "${concatTxtPath}" -c copy "${outputPath}"`;
        console.log(`Executing FFmpeg: ${cmd}`);

        await new Promise((resolve, reject) => {
            exec(cmd, (execErr, stdout, stderr) => {
                if (execErr) {
                    console.error(`FFmpeg error:`, execErr);
                    reject(execErr);
                } else {
                    console.log(`Stitching complete! Output saved.`);
                    resolve();
                }
            });
        });

        // Upload to R2
        console.log("Uploading stitched video to R2...");
        const stitchedBuffer = fs.readFileSync(outputPath);
        const finalFileName = `generated/${userId}/stitched_${Date.now()}.mp4`;
        
        await r2.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: finalFileName,
            Body: stitchedBuffer,
            ContentType: 'video/mp4'
        }));
        
        const persistedUrl = `${R2_PUBLIC_URL}/${finalFileName}`;
        console.log(`Final Stitched URL on R2: ${persistedUrl}`);

        // Update asset record in Supabase
        console.log("Updating Asset record in Supabase...");
        const { error: updateErr } = await supabaseAdmin
            .from('assets')
            .update({
                url: persistedUrl,
                status: 'Draft' // turn placeholder card into active asset
            })
            .eq('id', assetId);

        if (updateErr) throw updateErr;

        console.log(`\n✅ SUCCESSFULLY retrieved, stitched, and updated asset ${assetId}!`);

    } catch (stitchErr) {
        console.error("❌ Stitching or database updates failed:", stitchErr.message);
    } finally {
        // Cleanup temp dir
        try {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        } catch (e) {}
    }
}

run().catch(console.error);
