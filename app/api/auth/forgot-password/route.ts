import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: Request) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Determine current origin (e.g. http://local.nobogent.com or https://app.nobogent.com)
    const origin = request.headers.get('origin') || request.headers.get('referer') || 'https://app.nobogent.com'
    const baseUrl = origin.replace(/\/$/, '')
    const redirectTo = `${baseUrl}/auth/callback?next=/auth/reset-password`

    // Send the password reset email via admin client (bypasses browser PKCE requirement)
    const { error: resetErr } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo
    })

    if (resetErr) {
      console.error('[FORGOT PASSWORD API] Reset email error:', resetErr)
      return NextResponse.json({ success: false, error: resetErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, message: 'Password reset instructions sent!' })

  } catch (err: any) {
    console.error('[FORGOT PASSWORD API] Unexpected error:', err)
    return NextResponse.json({ success: false, error: err.message || 'Server error' }, { status: 500 })
  }
}
