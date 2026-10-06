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

  // 1. Amritsar Omaxe Campaign Launch
  console.log('\n======================================================');
  console.log('📌 1. LAUNCHING AMRITSAR OMAXE LEADGEN CAMPAIGN VIA MCP');
  console.log('======================================================');

  const amritsarResult = await metaMcp.meta_mcp_launch_leadgen_campaign.execute({
    campaignName: 'Amritsar Omaxe - Premium Residential Plots',
    dailyBudgetInr: 500,
    imageUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/68b55a31-a16d-454d-a20f-11adabf590b0/1791187545713-PremiumResidentialPlotsinAmritsar.jpg',
    adCopy: {
      headline: 'Omaxe Amritsar | Plots From ₹60 Lacs',
      primaryText: `Build your dream home at Omaxe Amritsar! 🌳🏡

Exclusive 300 & 500 Sq. Yds. premium residential plots in an approved, luxury gated township.

✅ Prime Location in Amritsar
✅ Spacious plots with lush landscaped greens
✅ 24/7 Gated Security & Modern Infrastructure
✅ Starting at ₹60 Lacs
✅ Ideal for end-use & high-growth investment

Tap 'Learn More' to explore available plot sizes, layouts, and pricing details!

📞 +91 95178 31205
🏢 Bioque Estates International`,
      description: '300 & 500 Sq. Yd Plots'
    },
    formQuestions: [
      {
        label: 'What is your investment budget?',
        options: ['60L - 70L', '70L-80L', 'Above 80L']
      },
      {
        label: 'How soon are you looking to buy?',
        options: ['Immediately', 'This Month', 'Next month']
      }
    ],
    highIntent: true,
    whatsappRedirectUrl: 'https://wa.me/919517831205?text=Hi%20Bioque%20Estates%2C%20I%20am%20interested%20in%20Omaxe%20Amritsar%20Plots.',
    targetLocations: {
      cities: [
        {
          key: '1016294',
          name: 'Amritsar',
          radius: 50,
          distance_unit: 'kilometer'
        }
      ]
    },
    ageMin: 30,
    ageMax: 65,
    status: 'ACTIVE'
  });

  console.log('Amritsar Campaign Result:', JSON.stringify(amritsarResult, null, 2));

  // 2. Benghatti Campaign Launch
  console.log('\n======================================================');
  console.log('📌 2. LAUNCHING BENGHATTI DUBAI LEADGEN CAMPAIGN VIA MCP');
  console.log('======================================================');

  const benghattiResult = await metaMcp.meta_mcp_launch_leadgen_campaign.execute({
    campaignName: 'Binghatti Dubai - Luxury Starfall & Residences',
    dailyBudgetInr: 500,
    imageUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/library/68b55a31-a16d-454d-a20f-11adabf590b0/1791187544504-DubaiInvestmentOpportunityPoster.jpg',
    adCopy: {
      headline: 'Binghatti Luxury Dubai Residences',
      primaryText: `Invest in Dubai's most iconic architectural landmarks by Binghatti! 🌆✨

Discover luxury residences in Al Jaddaf, Downtown & Business Bay with world-class amenities, high capital appreciation, and tax-free rental returns.

✨ Prime Locations: Downtown, Business Bay & Al Jaddaf
✨ Celestial Architecture, Private Observatory & Luxury Amenities
✨ High ROI, strong rental yields & capital growth
✨ Flexible investor payment plans & Golden Visa eligibility
✨ Starting from ₹3.2 Cr (AED 1.4M+)

Tap 'Learn More' to view available units, floor plans, and pricing calculation!

📞 +91 95178 31205
🏢 Bioque Estates International`,
      description: 'Dubai Luxury Residences'
    },
    formQuestions: [
      {
        label: 'What is your investment budget?',
        options: ['3.2 Cr - 4.2 Cr', '4.2 Cr - 5.2 Cr', 'Above 5.2 Cr']
      },
      {
        label: 'How soon are you looking to buy?',
        options: ['Immediately', 'This Month', 'Next month']
      }
    ],
    highIntent: true,
    whatsappRedirectUrl: 'https://wa.me/919517831205?text=Hi%20Bioque%20Estates%2C%20I%20am%20interested%20in%20Binghatti%20Dubai%20Properties.',
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

  console.log('Benghatti Campaign Result:', JSON.stringify(benghattiResult, null, 2));

  // Update properties in DB if applicable
  if (amritsarResult.campaignId) {
    await supabaseAdmin
      .from('properties')
      .update({
        meta_campaign_id: amritsarResult.campaignId,
        meta_campaign_status: 'ACTIVE'
      })
      .eq('id', '16adb76b-4f7e-462c-8b70-ce058123a383');
  }

  if (benghattiResult.campaignId) {
    await supabaseAdmin
      .from('properties')
      .update({
        meta_campaign_id: benghattiResult.campaignId,
        meta_campaign_status: 'ACTIVE'
      })
      .eq('id', '04629db8-3081-44bd-a3f6-a9dd2b54d98b');
  }

  console.log('\n======================================================');
  console.log('🎉 BOTH CAMPAIGNS LAUNCHED VIA META ADS MCP SUCCESSFULLY');
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal error launching campaigns:', err);
  process.exit(1);
});
