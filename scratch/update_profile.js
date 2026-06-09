const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const userId = 'fd337d26-5919-42c1-a805-577fda7b93bf';
    const { data: profile, error } = await supabase
        .from('profiles')
        .update({
            subscription_plan: 'growth',
            subscription_status: 'active'
        })
        .eq('id', userId)
        .select()
        .single();

    if (error) {
        console.error("Error updating profile:", error);
    } else {
        console.log("=== Profile Updated Successfully ===");
        console.log("ID:", profile.id);
        console.log("Business Name:", profile.business_name);
        console.log("Subscription Plan:", profile.subscription_plan);
        console.log("Subscription Status:", profile.subscription_status);
    }
}

run();
