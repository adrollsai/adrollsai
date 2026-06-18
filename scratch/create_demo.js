const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const BLUE_SQUARE_ID = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const HOMCOM_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2';
const RCHOPRA_ID = 'bc63c065-9bcc-4793-bedc-f0960406425b';
const REALTY_NATION_ID = 'c890a11f-84ce-4592-ab8f-8682927b1a9d';
const SOURCE_CAMPAIGNS_USER_ID = 'a3217c1a-a4d7-4511-b0e5-12c0b54f7071';

const TARGET_EMAIL = 'adrolls-realty-demo@adrolls.in';
const TARGET_PASSWORD = 'AdrollsRealty2026!';

async function run() {
    console.log("=== Creating fully functional Demo Admin account ===");

    // 1. Check if user already exists
    console.log("\n--- Checking if target user already exists ---");
    const { data: existingProfiles, error: fetchProfileErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', TARGET_EMAIL);
    
    if (fetchProfileErr) {
        console.error("Error checking profiles:", fetchProfileErr);
    }

    if (existingProfiles && existingProfiles.length > 0) {
        const oldUserId = existingProfiles[0].id;
        console.log(`Found existing user with ID: ${oldUserId}. Cleaning up old data first.`);

        // Delete from dependent tables
        await supabaseAdmin.from('campaigns').delete().eq('user_id', oldUserId);
        await supabaseAdmin.from('landing_pages').delete().eq('user_id', oldUserId);
        await supabaseAdmin.from('leads').delete().eq('user_id', oldUserId);
        await supabaseAdmin.from('assets').delete().eq('user_id', oldUserId);
        await supabaseAdmin.from('properties').delete().eq('user_id', oldUserId);
        await supabaseAdmin.from('profiles').delete().eq('id', oldUserId);

        // Delete from Auth
        const { error: deleteAuthErr } = await supabaseAdmin.auth.admin.deleteUser(oldUserId);
        if (deleteAuthErr) {
            console.log("Error deleting auth user (may not exist in auth anymore):", deleteAuthErr.message);
        } else {
            console.log("Successfully deleted auth user from Supabase Auth.");
        }
    }

    // 2. Create the user in Auth
    console.log("\n--- Creating User in Supabase Auth ---");
    const { data: authData, error: authCreateErr } = await supabaseAdmin.auth.admin.createUser({
        email: TARGET_EMAIL,
        password: TARGET_PASSWORD,
        email_confirm: true
    });

    if (authCreateErr) {
        console.error("Failed to create auth user:", authCreateErr);
        return;
    }

    const newUserId = authData.user.id;
    console.log(`Successfully created Auth User with ID: ${newUserId}`);

    // 3. Fetch rchopra489 profile fields to copy tokens/logo/video/audio
    console.log("\n--- Fetching rchopra489 Profile ---");
    const { data: rchopra, error: rchopraErr } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', RCHOPRA_ID)
        .single();
    
    if (rchopraErr || !rchopra) {
        console.error("Failed to load rchopra profile:", rchopraErr);
        return;
    }
    console.log(`Fetched rchopra tokens and settings successfully.`);

    // 4. Create Profile for the Demo User
    console.log("\n--- Creating Demo Admin Profile ---");
    const demoProfile = {
        id: newUserId,
        email: TARGET_EMAIL,
        business_name: 'Adrolls Realty',
        role: 'admin',
        subscription_plan: 'enterprise',
        subscription_status: 'active',
        subscription_valid_until: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 10 years in future
        ad_credits: 10000,
        onboarding_completed: true,
        ai_creatives_used: 0,
        campaign_launches_used: 0,
        ai_ad_optimizations_used: 0,
        remarketing_campaigns_used: 0,
        seo_articles_used: 0,
        storage_bytes_used: 0,
        
        // Copy tokens and facebook settings
        facebook_token: rchopra.facebook_token,
        ad_account_id: rchopra.ad_account_id,
        pixel_id: rchopra.pixel_id,
        selected_page_id: rchopra.selected_page_id,
        selected_page_name: rchopra.selected_page_name,
        selected_page_token: rchopra.selected_page_token,
        logo_url: rchopra.logo_url,
        
        // Character (ref video / audio / description)
        character_url: rchopra.character_url,
        character_audio_url: rchopra.character_audio_url,
        character_description: rchopra.character_description,
        
        // Whatsapp configuration
        whatsapp_access_token: rchopra.whatsapp_access_token,
        whatsapp_business_account_id: rchopra.whatsapp_business_account_id,
        whatsapp_phone_number_id: rchopra.whatsapp_phone_number_id,
        whatsapp_phone_number: rchopra.whatsapp_phone_number,
        whatsapp_waba_id: rchopra.whatsapp_waba_id,
        whatsapp_connected_at: rchopra.whatsapp_connected_at,
        currency: rchopra.currency || 'INR'
    };

    const { error: profileUpsertErr } = await supabaseAdmin
        .from('profiles')
        .upsert(demoProfile);

    if (profileUpsertErr) {
        console.error("Failed to create profile:", profileUpsertErr);
        return;
    }
    console.log("Successfully created profiles table record for demo account.");

    // 5. Copy properties from Blue Square Infra
    console.log("\n--- Copying properties from Blue Square Infra ---");
    const { data: bsiProperties, error: bsiPropErr } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('user_id', BLUE_SQUARE_ID);
    
    if (bsiPropErr) {
        console.error("Failed to fetch Blue Square Infra properties:", bsiPropErr);
        return;
    }

    console.log(`Found ${bsiProperties.length} properties to copy.`);
    const propertyMap = {}; // mapping old property IDs to new property IDs

    for (const prop of bsiProperties) {
        const newPropData = {
            user_id: newUserId,
            title: prop.title,
            description: prop.description,
            address: prop.address,
            price: prop.price,
            property_type: prop.property_type,
            status: prop.status,
            image_url: prop.image_url,
            images: prop.images,
            youtube_url: prop.youtube_url,
            master_creatives: prop.master_creatives,
            marketing_copy_template: prop.marketing_copy_template,
            rera_number: prop.rera_number,
            brochure_url: prop.brochure_url,
            floor_plan_url: prop.floor_plan_url,
            configurations: prop.configurations,
            auto_generate: false // don't enable video toggle
        };

        const { data: insertedProp, error: insertPropErr } = await supabaseAdmin
            .from('properties')
            .insert(newPropData)
            .select()
            .single();
        
        if (insertPropErr) {
            console.error(`Failed to insert property "${prop.title}":`, insertPropErr);
        } else {
            console.log(`Copied Property: "${prop.title}" -> New ID: ${insertedProp.id}`);
            propertyMap[prop.id] = insertedProp.id;
        }
    }

    // 6. Copy assets from Blue Square Infra & videos from Homcom Realtors
    console.log("\n--- Copying assets ---");
    const { data: bsiAssets, error: bsiAssetsErr } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', BLUE_SQUARE_ID);
    
    if (bsiAssetsErr) {
        console.error("Error fetching Blue Square Infra assets:", bsiAssetsErr);
    }

    const { data: homcomVideos, error: homcomVideosErr } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', HOMCOM_ID)
        .eq('type', 'video');
    
    if (homcomVideosErr) {
        console.error("Error fetching Homcom videos:", homcomVideosErr);
    }

    const assetsToCopy = [...(bsiAssets || []), ...(homcomVideos || [])];
    console.log(`Found ${assetsToCopy.length} assets to copy (BSI: ${bsiAssets?.length || 0}, Homcom videos: ${homcomVideos?.length || 0})`);

    for (const asset of assetsToCopy) {
        const newAssetData = {
            user_id: newUserId,
            url: asset.url,
            type: asset.type,
            status: asset.status,
            master_creative_id: asset.master_creative_id,
            share_stats: asset.share_stats,
            caption: asset.caption,
            kie_task_id: asset.kie_task_id,
            metadata: asset.metadata,
            property_id: asset.property_id ? (propertyMap[asset.property_id] || null) : null
        };

        const { error: insertAssetErr } = await supabaseAdmin
            .from('assets')
            .insert(newAssetData);
        
        if (insertAssetErr) {
            console.error(`Error inserting asset ${asset.url}:`, insertAssetErr.message);
        } else {
            console.log(`Copied Asset (${asset.type}): ${asset.url.substring(0, 80)}...`);
        }
    }

    // 7. Copy Landing Page from Realty Nation
    console.log("\n--- Copying landing page from Realty Nation ---");
    const { data: rnPages, error: rnPagesErr } = await supabaseAdmin
        .from('landing_pages')
        .select('*')
        .eq('user_id', REALTY_NATION_ID)
        .ilike('slug', 'highland-mayfield%');
    
    if (rnPagesErr || !rnPages || rnPages.length === 0) {
        console.error("Could not find Highland Mayfield landing page from Realty Nation:", rnPagesErr);
    } else {
        // Find the page that is slug="highland-mayfield" or the first page
        const sourcePage = rnPages.find(p => p.slug === 'highland-mayfield') || rnPages[0];
        console.log(`Using landing page: "${sourcePage.title}" with old slug "${sourcePage.slug}"`);

        // Update HTML content to use new user and pixel details
        let updatedHtml = sourcePage.html_content;
        
        // Replace old user ID with new user ID in html
        if (updatedHtml) {
            updatedHtml = updatedHtml.split(REALTY_NATION_ID).join(newUserId);
            // Replace old pixel ID with new pixel ID if set
            if (rchopra.pixel_id && sourcePage.pixel_id) {
                updatedHtml = updatedHtml.split(sourcePage.pixel_id).join(rchopra.pixel_id);
            }
        }

        const newPageData = {
            user_id: newUserId,
            slug: 'highland-mayfield',
            title: sourcePage.title,
            product_name: sourcePage.product_name,
            html_content: updatedHtml,
            form_id: sourcePage.form_id, // we keep the same form structure
            booking_enabled: sourcePage.booking_enabled,
            pixel_id: rchopra.pixel_id,
            property_id: sourcePage.property_id ? (propertyMap[sourcePage.property_id] || null) : null
        };

        const { error: insertPageErr } = await supabaseAdmin
            .from('landing_pages')
            .insert(newPageData);
        
        if (insertPageErr) {
            console.error("Failed to copy landing page:", insertPageErr);
        } else {
            console.log(`Successfully copied landing page to slug: "highland-mayfield"`);
        }
    }

    // 8. Populate CRM Leads
    console.log("\n--- Populating CRM Leads ---");
    // Get first property mapped or null
    const firstPropertyId = Object.values(propertyMap)[0] || null;

    const demoLeads = [
        {
            user_id: newUserId,
            name: 'Arjun Mehta',
            email: 'arjun.mehta@example.com',
            phone: '+919876543210',
            notes: 'Looking for a 3BHK luxury apartment in New Chandigarh. Interested in top floor.',
            status: 'Active',
            pipeline_stage: 'New',
            source: 'Facebook Ads',
            ad_name: 'Adrolls Realty Launch Campaign',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 6 * 3600000).toISOString() // 6 hrs ago
        },
        {
            user_id: newUserId,
            name: 'Priya Sharma',
            email: 'priya.sharma@example.com',
            phone: '+919812345678',
            notes: 'Interested in site visit this weekend. Budget around 1.5 Cr.',
            status: 'Active',
            pipeline_stage: 'Qualified',
            source: 'Google Search',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 1 * 24 * 3600000).toISOString() // 1 day ago
        },
        {
            user_id: newUserId,
            name: 'Amit Patel',
            email: 'amit.patel@gmail.com',
            phone: '+919898989898',
            notes: 'Scheduled site visit for Sunday at 4 PM. Family visiting together.',
            status: 'Active',
            pipeline_stage: 'Appointment booked',
            source: 'WhatsApp',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 2 * 24 * 3600000).toISOString() // 2 days ago
        },
        {
            user_id: newUserId,
            name: 'Sneha Reddy',
            email: 'sneha.reddy@example.com',
            phone: '+919777888999',
            notes: 'Completed site visit. Satisfied with layout. Discussing payment terms.',
            status: 'Active',
            pipeline_stage: 'Appointment done',
            source: 'Facebook Ads',
            ad_name: 'Adrolls Realty Launch Campaign',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 3 * 24 * 3600000).toISOString() // 3 days ago
        },
        {
            user_id: newUserId,
            name: 'Rohan Malhotra',
            email: 'rohan.malhotra@yahoo.com',
            phone: '+919999000011',
            notes: 'Booking amount of 5 Lakhs received. Form submitted.',
            status: 'Active',
            pipeline_stage: 'Closed',
            source: 'Direct',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 5 * 24 * 3600000).toISOString() // 5 days ago
        },
        {
            user_id: newUserId,
            name: 'Vikram Singh',
            email: 'vikram.singh@gmail.com',
            phone: '+919123456789',
            notes: 'Budget is too low (only 60 Lakhs). Marked unqualified for luxury project.',
            status: 'Active',
            pipeline_stage: 'Unqualified',
            source: 'Facebook Ads',
            property_id: firstPropertyId,
            created_at: new Date(Date.now() - 6 * 24 * 3600000).toISOString() // 6 days ago
        }
    ];

    const { error: insertLeadsErr } = await supabaseAdmin
        .from('leads')
        .insert(demoLeads);
    
    if (insertLeadsErr) {
        console.error("Failed to insert CRM leads:", insertLeadsErr);
    } else {
        console.log(`Successfully populated ${demoLeads.length} demo leads in the CRM.`);
    }

    // 9. Copy campaigns from SOURCE_CAMPAIGNS_USER_ID
    console.log("\n--- Copying campaigns from BlueSquare Infra subaccount ---");
    const { data: campaigns, error: fetchCampaignsErr } = await supabaseAdmin
        .from('campaigns')
        .select('*')
        .eq('user_id', SOURCE_CAMPAIGNS_USER_ID);
    
    if (fetchCampaignsErr) {
        console.error("Failed to fetch campaigns:", fetchCampaignsErr);
    } else if (campaigns && campaigns.length > 0) {
        console.log(`Found ${campaigns.length} campaigns to copy.`);
        
        for (const camp of campaigns) {
            // Rename to refer to "Adrolls Realty" instead of "a321" or "The Grand Orchard Estate"
            let newCampaignName = camp.name;
            if (newCampaignName.includes('The Grand Orchard Estate')) {
                newCampaignName = newCampaignName.replace('The Grand Orchard Estate', 'Adrolls Realty Launch');
            }
            if (newCampaignName.includes('a321')) {
                newCampaignName = newCampaignName.replace('a321', 'Adrolls Realty');
            }

            const newCampaignData = {
                user_id: newUserId,
                meta_campaign_id: camp.meta_campaign_id,
                meta_adset_id: camp.meta_adset_id,
                meta_ad_id: camp.meta_ad_id,
                name: newCampaignName,
                status: camp.status,
                budget_type: camp.budget_type,
                total_budget: camp.total_budget,
                start_time: camp.start_time,
                end_time: camp.end_time
            };

            const { error: insertCampErr } = await supabaseAdmin
                .from('campaigns')
                .insert(newCampaignData);
            
            if (insertCampErr) {
                console.error(`Failed to copy campaign "${camp.name}":`, insertCampErr.message);
            } else {
                console.log(`Copied Campaign: "${camp.name}" -> "${newCampaignName}"`);
            }
        }
    } else {
        console.log("No campaigns found to copy from source user.");
    }

    console.log("\n==================================================");
    console.log("DEMO ACCOUNT READY!");
    console.log(`Email: ${TARGET_EMAIL}`);
    console.log(`Password: ${TARGET_PASSWORD}`);
    console.log("==================================================");
}

run().catch(console.error);
