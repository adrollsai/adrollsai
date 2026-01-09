import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
// Removed sendNotification import to avoid accidental push loops
// import { sendNotification } from '@/utils/notification-helper' 

// Service Role for accessing all users/leads
const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
)

// FIX: Change runtime from 'edge' to 'nodejs' 
export const runtime = 'nodejs' 
export const dynamic = 'force-dynamic' // Ensure it doesn't cache

export async function GET(request: Request) {
    // Basic Auth via Header (optional security)
    const authHeader = request.headers.get('authorization')
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    
    // --- 1. STREAK SAVER LOGIC (Run only between 6PM - 8PM approx) ---
    // Assuming server time is UTC.
    
    let streakCount = 0
    
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0] // YYYY-MM-DD
    const todayStr = now.toISOString().split('T')[0]

    // Fetch users active yesterday
    const { data: riskUsers } = await supabaseAdmin
        .from('profiles')
        .select('id, last_activity_date, current_streak')
        .gte('last_activity_date', `${yesterdayStr}T00:00:00`)
        .lt('last_activity_date', `${todayStr}T00:00:00`)
        .gt('current_streak', 0) // Only those with a streak to lose

    if (riskUsers && riskUsers.length > 0) {
        // BULK INSERT NOTIFICATIONS (Fast & Safe)
        // We skip Web Push to prevent timeout on free tier with >50 users.
        const notifications = riskUsers.map(user => ({
            user_id: user.id,
            title: "🔥 Streak at Risk!",
            message: `You have a ${user.current_streak} day streak! Log in now to keep your XP multiplier.`,
            type: "system",
            action_link: "/dashboard",
            is_read: false
        }));
        
        await supabaseAdmin.from('notifications').insert(notifications);
        streakCount = riskUsers.length
    }


    // --- 2. STALE LEADS (SPEED TO LEAD) ---
    // Find leads created between 1 hour ago and 15 mins ago that are still 'New'
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
    const ninetyMinsAgo = new Date(now.getTime() - 90 * 60 * 1000).toISOString()

    const { data: staleLeads } = await supabaseAdmin
        .from('leads')
        .select('id, user_id, name, created_at')
        .eq('pipeline_stage', 'New')
        .lt('created_at', fifteenMinsAgo)
        .gt('created_at', ninetyMinsAgo) 

    let leadCount = 0
    if (staleLeads && staleLeads.length > 0) {
        // De-duplicate users to avoid spamming 5 times for 5 leads
        const userLeadsMap: Record<string, number> = {}
        staleLeads.forEach(l => {
            userLeadsMap[l.user_id] = (userLeadsMap[l.user_id] || 0) + 1
        })

        // Construct bulk notifications
        const leadNotifications = Object.keys(userLeadsMap).map(userId => {
            const count = userLeadsMap[userId]
            const msg = count === 1 
                ? "⏳ Hot Lead Waiting! A new lead is waiting for over 15 mins. Call now!"
                : `⏳ You have ${count} uncontacted leads waiting. Speed to lead is key!`
            
            return {
                user_id: userId,
                title: "💰 Money on the Table",
                message: msg,
                type: "lead",
                action_link: "/dashboard/crm",
                is_read: false
            }
        })
        
        await supabaseAdmin.from('notifications').insert(leadNotifications);
        leadCount = staleLeads.length
    }

    return NextResponse.json({ 
        success: true, 
        streak_notifications: streakCount,
        lead_notifications: leadCount
    })
}