const http = require('http');

const subAccounts = [
    {
        name: 'Realty Nation',
        domain: 'app.realtynationmohali.com',
        slug: 'highland-mayfield-4167'
    },
    {
        name: 'Blue Square Infra',
        domain: 'app.bluesquareinfra.in',
        slug: '1-kanal-super-luxury-kothi-new-chandigarh-5581'
    },
    {
        name: 'GNR HOMES',
        domain: 'gnrhomes.in',
        slug: 'gnr-homes-mohali-1234' // We will query pages first to get valid slug
    },
    {
        name: 'The ProEstate',
        domain: 'app.theproestate.in',
        slug: 'proestate-office-spaces-2345'
    }
];

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function checkSubAccount(sub, slug) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/${slug}`,
            method: 'GET',
            headers: {
                'Host': sub.domain
            },
            timeout: 5000
        };

        console.log(`Checking sub-account: ${sub.name} on domain: ${sub.domain} with path: /${slug}`);
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`Response Status: ${res.statusCode}`);
                if (res.statusCode >= 500) {
                    console.log(`❌ ERROR on ${sub.name}:`);
                    console.log(data);
                } else {
                    console.log(`✅ Success or redirect (${res.statusCode}) - snippet:`, data.slice(0, 200).trim());
                }
                resolve(res.statusCode);
            });
        });

        req.on('error', (err) => {
            console.log(`❌ Error connecting to localhost for ${sub.name}: ${err.message}`);
            resolve(500);
        });

        req.end();
    });
}

async function run() {
    // Let's first query landing pages in the DB to find valid slugs for these profiles
    console.log("=== Fetching valid slugs from DB ===");
    const { data: pages, error } = await supabaseAdmin
        .from('landing_pages')
        .select('id, user_id, slug, title, profiles(id, business_name, custom_domain)');

    if (error) {
        console.error("Error fetching pages:", error);
        return;
    }

    console.log(`Found ${pages.length} total landing pages in DB.`);

    for (const sub of subAccounts) {
        // Find a page belonging to this profile
        const subPage = pages.find(p => p.profiles && p.profiles.custom_domain === sub.domain);
        if (subPage) {
            console.log(`Found landing page for ${sub.name}: slug="${subPage.slug}"`);
            await checkSubAccount(sub, subPage.slug);
        } else {
            console.log(`No landing page in DB for ${sub.name} on domain ${sub.domain}. Checking with default slug.`);
            await checkSubAccount(sub, sub.slug);
        }
        console.log("----------------------------------------");
    }
}

run().catch(console.error);
