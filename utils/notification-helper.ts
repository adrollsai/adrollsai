import { SupabaseClient } from '@supabase/supabase-js'

type NotificationType = 'rivalry' | 'roi' | 'system' | 'lead'

// Helper to send a notification to the database
export async function sendNotification(
    supabase: SupabaseClient, 
    userId: string, 
    title: string, 
    message: string, 
    type: NotificationType,
    actionLink?: string
) {
    try {
        await supabase.from('notifications').insert({
            user_id: userId,
            title,
            message,
            type,
            action_link: actionLink,
            is_read: false
        })
    } catch (error) {
        console.error("Failed to send notification:", error)
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
        .select('business_name')
        .gt('total_xp', oldXp)     // Who had more XP than I used to...
        .lt('total_xp', newXp)     // ...but now has less XP than I do?
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