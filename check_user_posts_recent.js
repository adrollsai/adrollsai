const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUserPosts() {
  const userId = 'bc63c065-9bcc-4793-bedc-f0960406425b'; // rchopra489@gmail.com
  const { data: posts, error } = await supabaseAdmin
    .from('posts')
    .select('id, title, content, image_url, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) console.error(error);
  console.log(`Found ${posts?.length} posts for rchopra489@gmail.com:`);
  for (const p of posts || []) {
    console.log(`ID: ${p.id} | Status: ${p.status} | Title: ${p.title} | Image: ${p.image_url}`);
  }
}

checkUserPosts();
