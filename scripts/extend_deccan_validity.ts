import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DECCAN_USER_ID = '93c65dee-87a5-48e3-a2d2-406182a33b37';
// 30th November 2026 end of day (23:59:59.999 UTC)
const EXTENDED_VALIDITY_DATE = '2026-11-30T23:59:59.999+00:00';

async function main() {
    console.log(`[1] Fetching Deccan Realtors profile (${DECCAN_USER_ID})...`);
    const { data: profile, error: fetchErr } = await supabase
        .from('profiles')
        .select('id, business_name, email, full_name, subscription_status, subscription_valid_until, usage_reset_date, subscription_plan')
        .eq('id', DECCAN_USER_ID)
        .single();

    if (fetchErr || !profile) {
        console.error('Error fetching profile:', fetchErr);
        process.exit(1);
    }

    console.log('Current Profile State:');
    console.log(`  Name: ${profile.full_name}`);
    console.log(`  Business: ${profile.business_name}`);
    console.log(`  Email: ${profile.email}`);
    console.log(`  Plan: ${profile.subscription_plan}`);
    console.log(`  Status: ${profile.subscription_status}`);
    console.log(`  Current Validity: ${profile.subscription_valid_until}`);
    console.log(`  Usage Reset Date: ${profile.usage_reset_date}`);

    console.log(`\n[2] Updating subscription validity to: ${EXTENDED_VALIDITY_DATE}...`);
    const { data: updated, error: updateErr } = await supabase
        .from('profiles')
        .update({
            subscription_valid_until: EXTENDED_VALIDITY_DATE,
            usage_reset_date: EXTENDED_VALIDITY_DATE,
            subscription_status: 'active'
        })
        .eq('id', DECCAN_USER_ID)
        .select('id, business_name, email, subscription_status, subscription_valid_until, usage_reset_date, subscription_plan')
        .single();

    if (updateErr) {
        console.error('Failed to update validity:', updateErr);
        process.exit(1);
    }

    console.log('✅ Successfully updated profile in database:');
    console.log(updated);

    console.log('\n[3] Marking old subscription expiry notifications as read...');
    const { error: notifUpdateErr } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', DECCAN_USER_ID)
        .eq('type', 'subscription_reminder');

    if (notifUpdateErr) {
        console.warn('Note: Could not update old notifications:', notifUpdateErr);
    } else {
        console.log('✅ Previous subscription reminders marked as read.');
    }

    console.log('\n[4] Adding validity extension notification for user dashboard...');
    const { error: notifInsertErr } = await supabase
        .from('notifications')
        .insert({
            user_id: DECCAN_USER_ID,
            title: '🎉 Plan Validity Extended',
            message: 'Your plan validity has been extended to 30th November 2026. All campaigns and features are active!',
            type: 'system',
            action_link: '/dashboard/billing',
            is_read: false,
            created_at: new Date().toISOString()
        });

    if (notifInsertErr) {
        console.warn('Note: Could not insert notification:', notifInsertErr);
    } else {
        console.log('✅ Validity extension notification inserted successfully.');
    }

    console.log('\n=== COMPLETED SUCCESSFULLY ===');
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
