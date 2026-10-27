import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DECCAN_USER_ID = '93c65dee-87a5-48e3-a2d2-406182a33b37';
const TARGET_PROP_ID = 'bf38162c-9b35-4345-b54c-6407e9a6c8f2';

async function main() {
    console.log('[1] Fetching profile details for Deccan Realtors...');
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, business_name, city, address, phone')
        .eq('id', DECCAN_USER_ID)
        .single();
    console.log('Profile:', profile);

    console.log('\n[2] Updating property bf38162c-9b35-4345-b54c-6407e9a6c8f2 to "Real Estate Overseas and Alternate Investments"...');
    const updatePayload = {
        title: 'Real Estate Overseas and Alternate Investments',
        property_type: 'Overseas & Alternate Investments',
        address: 'Overseas & Global Alternate Investments',
        description: 'Curated real estate overseas and alternate investments (including Ashton Gray Investments and international portfolios) providing secure high-yield global assets, capital growth, and comprehensive advisory due diligence.',
        price: 'Investment On Request'
    };

    const { data: updatedProp, error: updateErr } = await supabase
        .from('properties')
        .update(updatePayload)
        .eq('id', TARGET_PROP_ID)
        .select()
        .single();

    if (updateErr) {
        console.error('Error updating property:', updateErr);
    } else {
        console.log('Updated property successfully:');
        console.log({
            id: updatedProp.id,
            title: updatedProp.title,
            property_type: updatedProp.property_type,
            address: updatedProp.address,
            description: updatedProp.description
        });
    }

    console.log('\n[3] Checking all Deccan properties:');
    const { data: allProps } = await supabase
        .from('properties')
        .select('id, title, address, property_type')
        .eq('user_id', DECCAN_USER_ID);
    
    allProps?.forEach(p => {
        console.log(`- ${p.title} | ${p.property_type} | Location: ${p.address || '[EMPTY]'}`);
    });
}

main().catch(console.error);
