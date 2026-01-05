import { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

// 1. Configure Web Push
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
                        console.log('[NOTIF DEBUG] 🗑️ Removing stale subscription from DB')
                        supabase.from('push_subscriptions').delete().eq('id', sub.id).then()
                    }
                })
        })

        await Promise.all(sendPromises)

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
    if (newXp <= oldXp) return;

    const { data: passedAgents } = await supabase
        .from('profiles')
        .select('id, business_name')
        .gt('total_xp', oldXp)     
        .lt('total_xp', newXp)    
        .neq('id', userId)
        .limit(1)

    if (passedAgents && passedAgents.length > 0) {
        const rivalName = passedAgents[0].business_name
        
        await sendNotification(
            supabase,
            userId,
            "🚀 Rank Up!",
            `You just surpassed ${rivalName} on the leaderboard! Keep pushing!`,
            'rivalry',
            '/dashboard?tab=leaderboard'
        )

        try {
            const { data: myProfile } = await supabase
                .from('profiles')
                .select('business_name')
                .eq('id', userId)
                .single()
                
            const myName = myProfile?.business_name || 'A competitor'

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

// --- NEW FUNCTION: Broadcast to Org Agents ---
export async function broadcastNotificationToOrg(
    supabase: SupabaseClient,
    orgId: string,
    title: string,
    message: string,
    actionLink?: string,
    excludeUserId?: string
) {
    console.log(`[NOTIF BROADCAST] Starting broadcast for Org: ${orgId}`)

    // 1. Get all agents in the Org
    const { data: agents, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('role', 'agent') // Notify only agents
        .neq('id', excludeUserId || '')

    if (error || !agents) {
        console.error("[NOTIF BROADCAST] ❌ Error fetching agents:", error?.message)
        return
    }

    console.log(`[NOTIF BROADCAST] Found ${agents.length} agents to notify.`)

    // 2. Loop and Send (Parallelized)
    await Promise.all(agents.map(agent => 
        sendNotification(supabase, agent.id, title, message, 'system', actionLink)
    ))

    console.log("[NOTIF BROADCAST] ✅ Broadcast complete.")
}