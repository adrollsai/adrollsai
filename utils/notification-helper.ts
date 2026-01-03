import { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// 1. Configure Web Push
// We check if keys exist to avoid crashing during build time if envs are missing
if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    try {
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:support@adrolls.ai',
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        )
    } catch (err) {
        console.error("VAPID Setup Error:", err)
    }
}

type NotificationType = 'rivalry' | 'roi' | 'system' | 'lead'

// Helper to send a notification to the database AND via Web Push
export async function sendNotification(
    supabase: SupabaseClient, 
    userId: string, 
    title: string, 
    message: string, 
    type: NotificationType,
    actionLink?: string
) {
    console.log(`[NOTIF DEBUG] Starting sendNotification for User: ${userId}`)

    try {
        // --- STEP 1: Insert into Internal DB (In-App Notification) ---
        const { data: notif, error } = await supabase.from('notifications').insert({
            user_id: userId,
            title,
            message,
            type,
            action_link: actionLink,
            is_read: false
        }).select().single()

        if (error) {
            console.error("[NOTIF DEBUG] ❌ DB Insert Error:", error.message)
            // We usually continue even if DB fails, to try Push, but usually if DB fails, Push might too.
        } else {
            console.log("[NOTIF DEBUG] ✅ DB Insert Success")
        }

        // --- STEP 2: Check VAPID Keys ---
        if (!process.env.VAPID_PRIVATE_KEY) {
            console.error("[NOTIF DEBUG] ⚠️ VAPID_PRIVATE_KEY is missing in .env.local")
            return
        }

        // --- STEP 3: Fetch User's Push Subscriptions ---
        const { data: subscriptions, error: subError } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('user_id', userId)

        if (subError) {
            console.error("[NOTIF DEBUG] ❌ Error fetching subscriptions:", subError.message)
            return
        }

        console.log(`[NOTIF DEBUG] Found ${subscriptions?.length || 0} subscriptions for user.`)

        if (!subscriptions || subscriptions.length === 0) {
            console.log("[NOTIF DEBUG] ℹ️ No subscriptions found. Skipping Web Push.")
            return
        }

        // --- STEP 4: Send Web Push to all registered devices ---
        const payload = JSON.stringify({
            title: title,
            body: message,
            url: actionLink || '/dashboard'
        })

        const sendPromises = subscriptions.map(sub => {
            const pushConfig = {
                endpoint: sub.endpoint,
                keys: {
                    auth: sub.auth,
                    p256dh: sub.p256dh
                }
            }
            
            // @ts-ignore - web-push types matching
            return webpush.sendNotification(pushConfig, payload)
                .then(() => {
                    console.log(`[NOTIF DEBUG] 🚀 PUSH SENT to subscription ${sub.id.substring(0,8)}...`)
                })
                .catch(err => {
                    console.error(`[NOTIF DEBUG] ❌ Push Failed for ${sub.id.substring(0,8)}... Code: ${err.statusCode}`)
                    
                    if (err.statusCode === 404 || err.statusCode === 410) {
                        // Subscription is dead (user reset permissions), remove it
                        console.log('[NOTIF DEBUG] 🗑️ Removing stale subscription from DB')
                        supabase.from('push_subscriptions').delete().eq('id', sub.id).then()
                    }
                })
        })

        await Promise.all(sendPromises)
        console.log("[NOTIF DEBUG] Finished processing all pushes.")

    } catch (error: any) {
        console.error("[NOTIF DEBUG] 🔥 Critical Failure:", error.message)
    }
}

// Logic to check if user surpassed someone and notify them
export async function checkAndNotifyRivalry(
    supabase: SupabaseClient, 
    userId: string, 
    oldXp: number, 
    newXp: number
) {
    // If we didn't gain XP, or somehow lost XP, skip
    if (newXp <= oldXp) return;

    // Check if we passed anyone in the XP gap
    const { data: passedAgents } = await supabase
        .from('profiles')
        .select('id, business_name')
        .gt('total_xp', oldXp)     // Who had more XP than I used to...
        .lt('total_xp', newXp)     // ...but now has less XP than I do?
        .neq('id', userId)
        .limit(1)

    if (passedAgents && passedAgents.length > 0) {
        const rivalName = passedAgents[0].business_name
        
        // Notify ME (The Winner)
        await sendNotification(
            supabase,
            userId,
            "🚀 Rank Up!",
            `You just surpassed ${rivalName} on the leaderboard! Keep pushing!`,
            'rivalry',
            '/dashboard?tab=leaderboard'
        )

        // Notify THE RIVAL (The Loser) - High ROI
        try {
            const { data: myProfile } = await supabase
                .from('profiles')
                .select('business_name')
                .eq('id', userId)
                .single()
                
            const myName = myProfile?.business_name || 'A competitor'

            // Note: We need a Service Role client usually to notify OTHER users securely,
            // but if this function runs in a server action/cron context that has admin rights, it works.
            // If running from client-side trigger, RLS might block this specific call unless configured.
            await sendNotification(
                supabase,
                passedAgents[0].id,
                "⚔️ Rivalry Alert",
                `${myName} just passed you on the leaderboard. Log in now to reclaim your spot!`,
                'rivalry',
                '/dashboard?tab=leaderboard'
            )
        } catch (err) {
            console.error("Rivalry notification error", err)
        }
    }
}