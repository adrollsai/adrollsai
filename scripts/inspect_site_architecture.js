const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectSites() {
  const { data: bioque } = await supabaseAdmin
    .from('landing_pages')
    .select('title, html_content')
    .eq('id', '9b410e2f-1284-42ea-a402-53b5c7cb79e2')
    .single();

  const { data: bluesquare } = await supabaseAdmin
    .from('landing_pages')
    .select('title, html_content')
    .eq('id', '291fb48f-3b6b-4dc3-97a3-aac3e73da84a')
    .single();

  console.log('=== BIOQUE ANALYSIS ===');
  console.log('Title:', bioque?.title);
  const bioqueHtml = bioque?.html_content || '';
  
  // Find navigateTo function
  const navIdx = bioqueHtml.indexOf('function navigateTo');
  if (navIdx !== -1) {
    console.log('Bioque navigateTo:\n', bioqueHtml.slice(navIdx, navIdx + 1200));
  }

  // Find views or containers
  const viewRegex = /id=["']([a-zA-Z0-9_\-]+view|[a-zA-Z0-9_\-]+page|view-[a-zA-Z0-9_\-]+|page-[a-zA-Z0-9_\-]+)["']/gi;
  let matches = [];
  let m;
  while ((m = viewRegex.exec(bioqueHtml)) !== null) {
    matches.push(m[1]);
  }
  console.log('Bioque views:', Array.from(new Set(matches)));

  console.log('\n=== BLUESQUARE ANALYSIS ===');
  console.log('Title:', bluesquare?.title);
  const bsHtml = bluesquare?.html_content || '';
  const bsNavIdx = bsHtml.indexOf('function navigateTo');
  if (bsNavIdx !== -1) {
    console.log('BlueSquare navigateTo:\n', bsHtml.slice(bsNavIdx, bsNavIdx + 1200));
  }
  let bsMatches = [];
  while ((m = viewRegex.exec(bsHtml)) !== null) {
    bsMatches.push(m[1]);
  }
  console.log('BlueSquare views:', Array.from(new Set(bsMatches)));
}

inspectSites();
