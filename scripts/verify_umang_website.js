const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyPage() {
  const { data: page, error } = await supabaseAdmin
    .from('landing_pages')
    .select('id, user_id, title, slug, html_content')
    .eq('user_id', 'b685d287-7d54-4c9c-ae03-a46bb96ebdde')
    .eq('slug', 'index')
    .single();

  console.log('Error:', error);
  console.log('Title:', page?.title);
  console.log('HTML Length:', page?.html_content?.length);

  const views = ['view-home', 'view-properties', 'view-property-detail', 'view-about', 'view-services', 'view-contact'];
  views.forEach(v => {
    console.log(v + ' present:', page?.html_content?.includes('id="' + v + '"'));
  });
  console.log('LIVE_PROPERTIES present:', page?.html_content?.includes('const LIVE_PROPERTIES ='));
  console.log('Umang Residency present:', page?.html_content?.includes('Umang Residency'));
}
verifyPage();
