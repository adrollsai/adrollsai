import crypto from 'crypto'

export interface CapiEventPayload {
  eventName: string
  lead: {
    id: string
    name?: string | null
    email?: string | null
    phone?: string | null
    value?: number | string | null
  }
  pixelId: string
  facebookToken: string
  customData?: Record<string, any>
}

function sha256(val?: string | null): string | null {
  if (!val) return null
  const cleaned = val.trim().toLowerCase()
  if (!cleaned) return null
  return crypto.createHash('sha256').update(cleaned).digest('hex')
}

function formatPhoneForCapi(phone?: string | null): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 10) digits = '91' + digits
  return sha256(digits)
}

export async function sendMetaCapiEvent(payload: CapiEventPayload) {
  const { eventName, lead, pixelId, facebookToken, customData = {} } = payload
  if (!pixelId || !facebookToken || !eventName) {
    return { success: false, error: 'Missing pixelId, facebookToken, or eventName' }
  }

  const nameParts = (lead.name || '').trim().split(/\s+/)
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  const userData: Record<string, any> = {}
  const hashedPhone = formatPhoneForCapi(lead.phone)
  const hashedEmail = sha256(lead.email)
  const hashedFn = sha256(firstName)
  const hashedLn = sha256(lastName)

  if (hashedPhone) userData.ph = [hashedPhone]
  if (hashedEmail) userData.em = [hashedEmail]
  if (hashedFn) userData.fn = [hashedFn]
  if (hashedLn) userData.ln = [hashedLn]

  const eventItem = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    user_data: userData,
    custom_data: {
      lead_id: lead.id,
      ...customData
    }
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [eventItem],
        access_token: facebookToken
      })
    })

    const data = await res.json()
    if (!res.ok) {
      console.error('[Meta CAPI Error]:', data)
      return { success: false, error: data }
    }

    console.log(`[Meta CAPI Success] Event "${eventName}" sent for lead ${lead.id}:`, data)
    return { success: true, data }
  } catch (err: any) {
    console.error('[Meta CAPI Network Error]:', err)
    return { success: false, error: err?.message || String(err) }
  }
}
