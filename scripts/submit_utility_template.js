const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createUtilityTemplate() {
  const { data: profile } = await supabase
    .from('profiles')
    .select('whatsapp_waba_id, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = profile.facebook_token;
  const wabaId = profile.whatsapp_waba_id;

  // Re-use sample image header handle or upload
  const sampleHandle = '4::aW1hZ2UvanBlZw==:ARZPk-9nO6vhq5M8-wGzF89_DT0howruuK4UuGLUAeypYN_QSBSzDSK77-rFpEEAv8it9Yg7OUqb_ifrOyZ-kjmnPmko0KlI0SkMdDH-yqLuhg:e:1793686044:873382051824848:100004107822747:ARYQmaBJYhRHXY4wHB8';

  const templatePayload = {
    name: 'account_update_notice',
    language: 'en_US',
    category: 'UTILITY',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_handle: [sampleHandle]
        }
      },
      {
        type: 'BODY',
        text: 'Hi {{1}}, your requested showcase details for {{2}} from {{3}} are ready. Please review the attached asset. Our team is available if you need any assistance.',
        example: {
          body_text: [['Valued Client', 'The Grand Crest', 'Nobogent']]
        }
      }
    ]
  };

  const createRes = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(templatePayload)
  });

  const createData = await createRes.json();
  console.log('Utility template create result:', JSON.stringify(createData, null, 2));
}

createUtilityTemplate().catch(console.error);

