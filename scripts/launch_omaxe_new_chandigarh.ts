import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { createMetaAdsMcpTools } from '../lib/agent/mcp/meta-ads-mcp';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0';

async function main() {
  console.log('🚀 Initializing Meta Ads MCP for Bioque Estates...');
  const metaMcp = createMetaAdsMcpTools(supabaseAdmin, BIOQUE_USER_ID);

  console.log('\n======================================================');
  console.log('📌 LAUNCHING OMAXE NEW CHANDIGARH LEADGEN CAMPAIGN VIA MCP');
  console.log('======================================================');

  const result = await metaMcp.meta_mcp_launch_leadgen_campaign.execute({
    campaignName: 'Omaxe New Chandigarh - Plots, Flats & Commercial',
    dailyBudgetInr: 500,
    imageUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/68b55a31-a16d-454d-a20f-11adabf590b0/1791189650742-OMAXENewChandigarhPropertyOptions.jpg',
    adCopy: {
      headline: 'Omaxe New Chandigarh | From ₹1 Cr*',
      primaryText: `OMAXE NEW CHANDIGARH 🏡✨
One Destination. Multiple Property Options.

Explore premium Plots, Luxury Flats, Independent Floors, and High-Yield Commercial Spaces in the heart of New Chandigarh!

📍 Prime Location: New Chandigarh
🏡 Residential | 🏢 Commercial | 🌳 Investment Opportunities
💰 Property options starting from ₹1 Cr*
✅ Gated Townships with 24/7 Security & World-Class Amenities
✅ Wide Roads, Green Parks & Complete Infrastructure

Tap 'Learn More' to view available properties, layouts, and pricing details!

📞 +91 95178 31205
🏢 Bioque Estates International`,
      description: 'Plots, Flats & Floors From ₹1 Cr'
    },
    formQuestions: [
      {
        label: 'Property Type',
        options: ['Plots', 'Flats', 'Independent Floors', 'Commercial Spaces']
      },
      {
        label: 'What is your investment budget?',
        options: ['1.0 Cr - 1.5 Cr', '1.5 Cr - 2.0 Cr', 'Above 2.0 Cr']
      },
      {
        label: 'How soon are you looking to buy?',
        options: ['Immediately', 'This Month', 'Next month']
      }
    ],
    highIntent: true,
    whatsappRedirectUrl: 'https://wa.me/919517831205?text=Hi%20Bioque%20Estates%2C%20I%20am%20interested%20in%20Omaxe%20New%20Chandigarh%20properties.',
    targetLocations: {
      cities: [
        {
          key: '1035473',
          name: 'Mohali',
          radius: 25,
          distance_unit: 'kilometer'
        },
        {
          key: '1033379',
          name: 'Ludhiana',
          radius: 25,
          distance_unit: 'kilometer'
        },
        {
          key: '2676092',
          name: 'Panchkula',
          radius: 25,
          distance_unit: 'kilometer'
        },
        {
          key: '2674292',
          name: 'Bathinda',
          radius: 25,
          distance_unit: 'kilometer'
        }
      ],
      regions: [
        {
          key: '1726',
          name: 'Chandigarh',
          country: 'IN'
        }
      ]
    },
    ageMin: 30,
    ageMax: 65,
    status: 'ACTIVE'
  });

  console.log('Campaign Result:', JSON.stringify(result, null, 2));

  if (result.success && result.campaignId) {
    console.log('\n🎉 OMAXE NEW CHANDIGARH CAMPAIGN LAUNCHED SUCCESSFULLY!');
  } else {
    console.error('\n❌ Campaign launch failed:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error launching campaign:', err);
  process.exit(1);
});
