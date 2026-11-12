/**
 * Multi-channel delivery for a finished video.
 *
 * The video pipeline previously stopped at an in-app notification, so the owner
 * only saw the video if they happened to open the dashboard. This sends the same
 * three channels a creative gets: WhatsApp (approved template), email (link +
 * copy), and it leaves the existing push notification untouched.
 *
 * Uses the Nobogent WABA for the business-initiated template (the tenant has
 * normally never messaged us, so their own WABA has no open 24h window), which is
 * the same pattern the daily creative uses.
 */

import nodemailer from 'nodemailer'

const WA_PHONE_ID =
  process.env.NOBOGENT_WHATSAPP_PHONE_ID ||
  process.env.DEV_WHATSAPP_PHONE_ID ||
  process.env.WHATSAPP_PHONE_NUMBER_ID ||
  '1185499271314063'

const WA_TOKEN =
  process.env.NOBOGENT_WHATSAPP_ACCESS_TOKEN ||
  process.env.DEV_WHATSAPP_ACCESS_TOKEN ||
  process.env.WHATSAPP_ACCESS_TOKEN ||
  ''

/** Approved UTILITY template (see utils/whatsapp/template-seeder.ts). */
export const VIDEO_READY_TEMPLATE = 'nobogent_video_ready_v2'

export interface DeliverVideoParams {
  userId: string
  assetId?: string | null
  videoUrl: string
  title?: string | null
  caption?: string | null
}

export interface DeliverVideoResult {
  whatsapp: boolean
  email: boolean
  skipped?: string
  error?: string
}

function normalisePhone(raw?: string | null): string {
  let p = String(raw || '').replace(/\D/g, '')
  if (p.length === 10) p = `91${p}`
  return p
}

export async function deliverVideoToAdmin(
  supabaseAdmin: any,
  params: DeliverVideoParams
): Promise<DeliverVideoResult> {
  const result: DeliverVideoResult = { whatsapp: false, email: false }
  const { userId, assetId, videoUrl, title, caption } = params

  if (!videoUrl || videoUrl.includes('designs.adrolls.in/processing')) {
    return { ...result, skipped: 'no_final_url' }
  }

  try {
    // Idempotency: a video can be finalized by more than one path (local FFmpeg,
    // Cloud Run, Lambda). Only ever notify once per asset.
    if (assetId) {
      const { data: asset } = await supabaseAdmin
        .from('assets')
        .select('metadata')
        .eq('id', assetId)
        .maybeSingle()
      if (asset?.metadata?.video_delivered === true) {
        return { ...result, skipped: 'already_delivered' }
      }
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('business_name, email, contact_number, whatsapp_personal_number')
      .eq('id', userId)
      .maybeSingle()

    if (!profile) return { ...result, skipped: 'profile_not_found' }

    const businessName = profile.business_name || 'Nobogent'
    const subjectTitle = (title || 'your listing').toString()
    const phone = normalisePhone(profile.whatsapp_personal_number || profile.contact_number)

    // ---- 1. WhatsApp template -------------------------------------------
    if (phone && WA_TOKEN && WA_PHONE_ID) {
      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone,
            type: 'template',
            template: {
              name: VIDEO_READY_TEMPLATE,
              language: { code: 'en_US' },
              components: [
                { type: 'body', parameters: [{ type: 'text', text: subjectTitle.slice(0, 120) }] }
              ]
            }
          })
        })
        const j: any = await res.json().catch(() => ({}))
        result.whatsapp = res.ok && !j?.error
        if (!result.whatsapp) console.warn('[Video Delivery] WhatsApp template failed:', j?.error?.message || res.status)
      } catch (e: any) {
        console.warn('[Video Delivery] WhatsApp error:', e?.message)
      }
    }

    // ---- 2. Email (video link + copy) ------------------------------------
    if (profile.email && process.env.SMTP_HOST && process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! }
        })

        const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e8e8ec">
    <div style="padding:22px 22px 0">
      <p style="margin:0 0 4px;font-size:12px;font-weight:800;letter-spacing:.08em;color:#64748b">VIDEO READY</p>
      <h2 style="margin:0 0 14px;font-size:20px;line-height:1.25;color:#0f172a">${escapeHtml(businessName)} — ${escapeHtml(subjectTitle)}</h2>
      <a href="${escapeHtml(videoUrl)}" style="display:inline-block;padding:13px 26px;background:#0f172a;color:#fff;text-decoration:none;border-radius:12px;font-size:13px;font-weight:800">▶ Watch the video</a>
      <p style="margin:14px 0 0;font-size:12px;color:#64748b">Direct link: <a href="${escapeHtml(videoUrl)}" style="color:#2563eb">${escapeHtml(videoUrl)}</a></p>
    </div>
    ${caption ? `
    <div style="padding:18px 22px 22px">
      <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;color:#64748b">📝 RECOMMENDED POST CAPTION</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;font-size:13px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${escapeHtml(caption)}</div>
    </div>` : ''}
    <div style="border-top:1px solid #f1f5f9;padding:16px 22px;text-align:center;color:#94a3b8;font-size:11px;font-weight:600">
      Sent automatically by Nobogent
    </div>
  </div>
</div>`

        await transporter.sendMail({
          from: `"${businessName}" <no-reply@mail.nobogent.com>`,
          to: profile.email,
          subject: `Your video for ${subjectTitle} is ready`,
          html
        })
        result.email = true
      } catch (e: any) {
        console.warn('[Video Delivery] Email error:', e?.message)
      }
    }

    if (assetId && (result.whatsapp || result.email)) {
      await supabaseAdmin
        .from('assets')
        .update({
          metadata: {
            video_delivered: true,
            video_delivered_at: new Date().toISOString(),
            video_delivered_channels: result
          }
        })
        .eq('id', assetId)
    }

    return result
  } catch (err: any) {
    console.error('[Video Delivery] Fatal:', err?.message)
    return { ...result, error: err?.message }
  }
}

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
