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
        const { error } = await supabase.from('notifications').insert({
            user_id: userId,
            title,
            message,
            type,
            action_link: actionLink,
            is_read: false
        })

        if (error) {
            console.error("[NOTIF DEBUG] ❌ DB Insert Error:", error.message)
        }

        // --- STEP 2: Send Web Push (Best Effort) ---
        // We do not await this to prevent blocking the UI/Response if it's slow
        sendWebPushSafely(supabase, userId, title, message, actionLink).catch(err => 
            console.error("Background Push Failed", err)
        )

    } catch (error: any) {
        console.error("[NOTIF DEBUG] 🔥 Critical Failure:", error.message)
    }
}

// Separated Web Push Logic to prevent timeouts
async function sendWebPushSafely(
    supabase: SupabaseClient, 
    userId: string, 
    title: string, 
    message: string, 
    url?: string
) {
    if (!process.env.VAPID_PRIVATE_KEY) return

    const { data: subscriptions } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId)

    if (!subscriptions?.length) return

    const payload = JSON.stringify({ title, body: message, url: url || '/dashboard' })

    const promises = subscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { auth: sub.auth, p256dh: sub.p256dh }
            }, payload)
        } catch (err: any) {
            if (err.statusCode === 404 || err.statusCode === 410) {
                await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            }
        }
    })

    // Wait for all pushes, but with a timeout so we don't hang forever
    await Promise.race([
        Promise.all(promises),
        new Promise(resolve => setTimeout(resolve, 2000)) // 2s Hard Timeout for pushes
    ])
}

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
    }
}

// --- NEW OPTIMIZED BROADCAST FUNCTION ---
export async function broadcastNotificationToOrg(
    supabase: SupabaseClient,
    orgId: string,
    title: string,
    message: string,
    actionLink?: string,
    excludeUserId?: string
) {
    console.log(`[NOTIF BROADCAST] Starting optimized broadcast for Org: ${orgId}`)

    // 1. Get all agents in the Org
    const { data: agents, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('organization_id', orgId)
        .eq('role', 'agent')
        .neq('id', excludeUserId || '')

    if (error || !agents || agents.length === 0) return

    // 2. Prepare Bulk Payload (SCALABILITY FIX)
    const notifications = agents.map(agent => ({
        user_id: agent.id,
        title,
        message,
        type: 'system',
        action_link: actionLink,
        is_read: false,
        created_at: new Date().toISOString()
    }))

    // 3. Single Bulk Insert (1 DB Call instead of 50)
    const { error: insertError } = await supabase
        .from('notifications')
        .insert(notifications)

    if (insertError) {
        console.error("Broadcast DB Error:", insertError.message)
    } else {
        console.log(`[NOTIF BROADCAST] ✅ Successfully inserted ${notifications.length} notifications.`)
    }

    // NOTE: We intentionally SKIP Web Push for broadcasts on the Free Plan
    // to prevent timeout crashes. Users will see the notification when they open the app.
}