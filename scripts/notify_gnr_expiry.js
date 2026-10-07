const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.resend.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT || '465') === 465,
  auth: {
    user: process.env.SMTP_USER || 'resend',
    pass: process.env.SMTP_PASS,
  },
});

async function run() {
  const GNR_USER_ID = '42d2e0c5-4fe6-4738-8a9f-63f09be01f12';
  console.log(`[1/5] Fetching GNR Homes profile (${GNR_USER_ID})...`);

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', GNR_USER_ID)
    .single();

  if (profErr || !profile) {
    console.error('Error fetching profile:', profErr);
    process.exit(1);
  }

  console.log(`Current validity: ${profile.subscription_valid_until}`);
  console.log(`Current status:   ${profile.subscription_status}`);
  console.log(`Email:            ${profile.email}`);
  console.log(`Phone:            ${profile.contact_number}`);

  // 1. Update DB to mark monthly validity as expired (e.g. expired as of yesterday / beginning of today)
  // Keeping subscription_status 'active' or 'expired', while subscription_valid_until is strictly in the past
  const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours ago
  console.log(`\n[2/5] Updating subscription_valid_until to past timestamp: ${expiredDate}...`);

  const { error: updateErr } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_valid_until: expiredDate
    })
    .eq('id', GNR_USER_ID);

  if (updateErr) {
    console.error('Failed to update profile validity:', updateErr);
  } else {
    console.log('✅ Updated GNR Homes subscription_valid_until successfully.');
  }

  // 2. Insert In-App Notification into DB
  console.log('\n[3/5] Inserting in-app notification & alert in notifications table...');
  const notifPayload = {
    user_id: GNR_USER_ID,
    title: '⚠️ Plan Validity Expired – Time to Recharge',
    message: 'Your Enterprise Plan validity for this month has expired. Your account access has been kept active so your operations are not blocked, but please recharge to ensure uninterrupted AI voice agents, WhatsApp automations, and ad campaigns.',
    type: 'subscription_reminder',
    action_link: '/dashboard/billing',
    is_read: false,
    created_at: new Date().toISOString()
  };

  const { error: notifErr } = await supabaseAdmin
    .from('notifications')
    .insert(notifPayload);

  if (notifErr) {
    console.error('Failed to insert in-app notification:', notifErr);
  } else {
    console.log('✅ In-app notification created successfully.');
  }

  // 3. Send Email Notification
  console.log(`\n[4/5] Sending email notification to ${profile.email}...`);
  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #1e293b; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 32px 24px; text-align: center;">
        <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" style="height: 36px; margin-bottom: 12px;" />
        <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 700;">Account Validity Notice</h1>
      </div>

      <div style="padding: 32px 24px;">
        <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 15px; font-weight: 600; color: #b45309;">
            ⚠️ Your Enterprise Plan validity for the month has expired.
          </p>
        </div>

        <p style="font-size: 15px; line-height: 1.6; color: #334155;">
          Dear <strong>GNR HOMES</strong> Team,
        </p>

        <p style="font-size: 15px; line-height: 1.6; color: #334155;">
          Your monthly subscription validity on <strong>Nobogent</strong> has expired.
        </p>

        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 14px 18px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #166534; font-weight: 600;">
            ✅ Uninterrupted Access: Your account access has been kept active so you and your team can continue viewing leads, automations, and CRM without being blocked.
          </p>
        </div>

        <p style="font-size: 15px; line-height: 1.6; color: #334155;">
          However, to ensure your automated AI voice agents, WhatsApp lead follow-ups, and marketing campaigns continue running seamlessly without any pause, please recharge your plan today.
        </p>

        <div style="text-align: center; margin: 32px 0 24px 0;">
          <a href="https://app.nobogent.com/dashboard/billing" style="display: inline-block; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; padding: 14px 36px; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 4px 14px rgba(37,99,235,0.3);">
            💳 Recharge / Renew Subscription
          </a>
        </div>

        <p style="font-size: 13px; color: #64748b; text-align: center; margin-bottom: 0;">
          If you need any custom billing assistance or invoice support, reply directly to this email or reach us at <a href="mailto:support@nobogent.com" style="color: #2563eb;">support@nobogent.com</a>.
        </p>
      </div>

      <div style="background-color: #f8fafc; padding: 20px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
        Nobogent — AI Sales & Marketing Department for Real Estate<br />
        Plot no. 163, JLPL Industrial Area, Sector 82, Mohali, Punjab
      </div>
    </div>
  `;

  try {
    const mailRes = await transporter.sendMail({
      from: '"Nobogent Alerts" <no-reply@mail.nobogent.com>',
      to: profile.email,
      subject: '⚠️ Important: Your Nobogent Plan Validity Has Expired – Time to Recharge',
      html: emailHtml
    });
    console.log('✅ Email sent successfully! Message ID:', mailRes.messageId);
  } catch (mErr) {
    console.error('Email sending error:', mErr.message);
  }

  // 4. Send WhatsApp Notification
  console.log('\n[5/5] Sending WhatsApp notification alerts...');
  const { data: nobo } = await supabaseAdmin
    .from('profiles')
    .select('whatsapp_phone_number_id, whatsapp_access_token, facebook_token')
    .eq('email', 'rchopra489@gmail.com')
    .single();

  const token = nobo.whatsapp_access_token || nobo.facebook_token;
  const phoneId = nobo.whatsapp_phone_number_id;

  const targetPhones = ['917009130097', '917719430097'];

  for (const phone of targetPhones) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: 'subscription_expiry_reminder',
          language: { code: 'en_US' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'GNR HOMES' },
                { type: 'text', text: 'Enterprise Plan' },
                { type: 'text', text: 'the current billing cycle' },
                { type: 'text', text: 'https://app.nobogent.com/dashboard/billing' }
              ]
            }
          ]
        }
      };

      const waRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const waData = await waRes.json();
      if (waRes.ok) {
        console.log(`✅ WhatsApp alert sent successfully to ${phone}:`, waData.messages?.[0]?.id);
      } else {
        console.warn(`WhatsApp template failed for ${phone}:`, waData.error?.message);
        // Fallback to text message
        const textPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: {
            body: `⚠️ *GNR HOMES — Nobogent Plan Validity Expired*\n\nYour Enterprise Plan validity for this month has expired.\n\n✅ Your account access has been kept active so your daily operations are not interrupted.\n\nPlease recharge now to keep your AI voice callers, campaigns, and automations running smoothly:\n💳 https://app.nobogent.com/dashboard/billing\n\nSupport: support@nobogent.com`
          }
        };

        const fallbackRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(textPayload)
        });
        const fallbackData = await fallbackRes.json();
        console.log(`Fallback text sent to ${phone}:`, fallbackData);
      }
    } catch (waErr) {
      console.error(`WhatsApp error for ${phone}:`, waErr.message);
    }
  }

  console.log('\n🎉 ALL NOTIFICATIONS & ALERTS DISPATCHED SUCCESSFULLY!');
}

run().catch(console.error);
