/**
 * Google Calendar Helper Utilities
 */

export async function refreshGoogleAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google client credentials in environment variables.")
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  })

  const data = await response.json()
  if (!response.ok || !data.access_token) {
    console.error("[Google OAuth Refresh] Token refresh failed:", data)
    throw new Error(data.error_description || data.error || "Failed to refresh Google access token")
  }

  return data.access_token
}

export async function getCalendarTimezone(accessToken: string, calendarId = 'primary'): Promise<string> {
  try {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })
    const data = await response.json()
    if (response.ok && data.timeZone) {
      return data.timeZone
    }
  } catch (err) {
    console.error("[Google Calendar Timezone] Failed to fetch timezone:", err)
  }
  return 'Asia/Kolkata' // Default fallback
}
