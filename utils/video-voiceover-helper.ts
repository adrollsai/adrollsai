import { createClient as createAdminClient } from '@supabase/supabase-js';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { queryKieTask, createGeminiTTS } from '@/utils/external-apis';
import { ensureMp3AudioBuffer } from '@/utils/audio-converter';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Robust, guaranteed resolver for voiceover audio in video pipeline.
 * Checks video task, asset metadata, profile audio, resolves async TTS task IDs,
 * persists raw audio to Cloudflare R2, sanitizes URLs, and provides on-the-fly TTS fallback.
 */
export async function resolveVoiceoverAudio(task: any, assetId?: string | null): Promise<string | null> {
    let candidateUrl: string | null = task?.audio_url || null;

    // Explicit check for native audio flag (Avatar Mode)
    if (candidateUrl === 'native' || candidateUrl === 'none') {
        console.log('[Voiceover Helper] Task is flagged with native audio. Bypassing voiceover resolution.');
        return null;
    }

    // 1. Check Asset record metadata & columns
    let assetMetadata: any = null;
    if (assetId) {
        try {
            const { data: assetRow } = await supabaseAdmin
                .from('assets')
                .select('metadata, voiceover_url, audio_url, caption')
                .eq('id', assetId)
                .maybeSingle();
            assetMetadata = assetRow?.metadata;
            
            // If asset explicitly denotes an Avatar video, NEVER attach or generate external voiceover
            if (assetMetadata?.isAvatar || assetMetadata?.presenterType === 'avatar' || assetMetadata?.audioUrl === 'native') {
                console.log(`[Voiceover Helper] Asset ${assetId} is confirmed as an Avatar video. Native Grok audio preserved.`);
                return null;
            }

            if (!candidateUrl) {
                candidateUrl = assetMetadata?.audioUrl || assetRow?.voiceover_url || assetRow?.audio_url || null;
            }
        } catch (e: any) {
            console.warn('[Voiceover Helper] Error fetching asset row:', e.message);
        }
    }

    if (candidateUrl === 'native' || candidateUrl === 'none') {
        return null;
    }

    // Grok Avatar mode safeguard: If video_model is grok and prompt targets presenter in Image 1 without explicit external TTS
    const isGrokAvatar = (task?.video_model === 'grok' || assetMetadata?.videoModel === 'grok') && 
                         (task?.prompts?.[0]?.toLowerCase().includes('image 1') || task?.prompts?.[0]?.toLowerCase().includes('presenter') || !candidateUrl);

    if (isGrokAvatar && (!candidateUrl || candidateUrl === 'native')) {
        console.log('[Voiceover Helper] Detected Grok Avatar generation without external audio. Preserving native lip sync audio.');
        return null;
    }

    // 2. Check Profile voice samples if presenter mode (Seedance only)
    if (!candidateUrl && task?.user_id && task?.video_model !== 'grok') {
        try {
            const { data: userProfile } = await supabaseAdmin
                .from('profiles')
                .select('character_audio_url, avatar_audio_url')
                .eq('id', task.user_id)
                .maybeSingle();
            candidateUrl = userProfile?.character_audio_url || userProfile?.avatar_audio_url || null;
        } catch (e: any) {
            console.warn('[Voiceover Helper] Error fetching profile audio:', e.message);
        }
    }

    // 3. If candidateUrl is an async TTS task ID (e.g. 'tts:abc123xyz'), poll Kie.ai and persist to R2
    if (candidateUrl && typeof candidateUrl === 'string' && candidateUrl.startsWith('tts:')) {
        const ttsTaskId = candidateUrl.replace(/^tts:/, '').trim();
        console.log(`[Voiceover Helper] Polling & resolving async Gemini TTS task ${ttsTaskId}...`);
        try {
            for (let t = 0; t < 25; t++) {
                const ttsStatus = await queryKieTask(ttsTaskId);
                if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                    try {
                        const audioRes = await fetch(ttsStatus.resultUrl);
                        if (audioRes.ok) {
                            const rawAudioBuffer = Buffer.from(await audioRes.arrayBuffer());
                            const audioBuffer = await ensureMp3AudioBuffer(rawAudioBuffer);
                            const r2Key = `voiceover/${Date.now()}_${ttsTaskId}.mp3`;
                            await r2.send(new PutObjectCommand({
                                Bucket: R2_BUCKET,
                                Key: r2Key,
                                Body: audioBuffer,
                                ContentType: 'audio/mpeg'
                            }));
                            candidateUrl = `${R2_PUBLIC_URL}/${r2Key.replace(/^\//, '')}`;
                            console.log(`[Voiceover Helper] Gemini TTS resolved and persisted to R2: ${candidateUrl}`);
                        } else {
                            candidateUrl = ttsStatus.resultUrl;
                        }
                    } catch (r2Err: any) {
                        console.error('[Voiceover Helper] R2 persistence error:', r2Err.message);
                        candidateUrl = ttsStatus.resultUrl;
                    }
                    break;
                }
                if (ttsStatus.state === 'fail') {
                    console.warn(`[Voiceover Helper] Gemini TTS task ${ttsTaskId} reported failure.`);
                    candidateUrl = null;
                    break;
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e: any) {
            console.warn(`[Voiceover Helper] TTS polling exception:`, e.message);
        }
    }

    // 4. Fallback: ONLY for non-Grok and non-Avatar models if voiceover was intended
    if ((!candidateUrl || candidateUrl.startsWith('tts:')) && assetId && task?.video_model !== 'grok' && !assetMetadata?.isAvatar) {
        try {
            const { data: assetRow } = await supabaseAdmin.from('assets').select('caption, metadata').eq('id', assetId).maybeSingle();
            const voiceText = assetRow?.caption || task?.final_caption || task?.prompts?.[0];
            if (voiceText && typeof voiceText === 'string' && voiceText.trim().length > 10) {
                console.log(`[Voiceover Helper] Synthesizing on-the-fly Gemini TTS voiceover for Seedance asset ${assetId}...`);
                const { taskId: newTtsId, error: newTtsErr } = await createGeminiTTS({
                    dialogueText: voiceText.trim(),
                    speakerName: 'Aoede',
                    style: '',
                    scene: 'Professional real estate commercial voiceover studio',
                    sampleContext: 'High converting luxury real estate marketing video'
                });

                if (newTtsId && !newTtsErr) {
                    for (let t = 0; t < 15; t++) {
                        await new Promise(r => setTimeout(r, 2000));
                        const ttsStatus = await queryKieTask(newTtsId);
                        if (ttsStatus.state === 'success' && ttsStatus.resultUrl) {
                            try {
                                const audioRes = await fetch(ttsStatus.resultUrl);
                                if (audioRes.ok) {
                                    const rawAudioBuffer = Buffer.from(await audioRes.arrayBuffer());
                                    const audioBuffer = await ensureMp3AudioBuffer(rawAudioBuffer);
                                    const r2Key = `voiceover/${Date.now()}_onthefly_${newTtsId}.mp3`;
                                    await r2.send(new PutObjectCommand({
                                        Bucket: R2_BUCKET,
                                        Key: r2Key,
                                        Body: audioBuffer,
                                        ContentType: 'audio/mpeg'
                                    }));
                                    candidateUrl = `${R2_PUBLIC_URL}/${r2Key.replace(/^\//, '')}`;
                                    console.log(`[Voiceover Helper] On-the-fly TTS generated & persisted: ${candidateUrl}`);
                                } else {
                                    candidateUrl = ttsStatus.resultUrl;
                                }
                            } catch (r2Err: any) {
                                candidateUrl = ttsStatus.resultUrl;
                            }
                            break;
                        }
                        if (ttsStatus.state === 'fail') break;
                    }
                }
            }
        } catch (e: any) {
            console.warn(`[Voiceover Helper] On-the-fly TTS synthesis exception:`, e.message);
        }
    }

    // 5. URL Sanitization: Remove any duplicate /adrolls-storage/ in R2 public domain URLs
    if (candidateUrl && typeof candidateUrl === 'string' && candidateUrl.startsWith('http')) {
        candidateUrl = candidateUrl.replace('r2.dev/adrolls-storage/', 'r2.dev/');
        
        // Sync the resolved HTTP audioUrl back to the asset metadata in DB
        if (assetId) {
            try {
                const { data: currentAsset } = await supabaseAdmin.from('assets').select('metadata').eq('id', assetId).maybeSingle();
                await supabaseAdmin.from('assets').update({
                    metadata: {
                        ...(currentAsset?.metadata || {}),
                        audioUrl: candidateUrl
                    }
                }).eq('id', assetId);
            } catch (syncErr: any) {
                console.warn('[Voiceover Helper] Failed to update asset metadata with resolved audioUrl:', syncErr.message);
            }
        }
        return candidateUrl;
    }

    return null;
}
