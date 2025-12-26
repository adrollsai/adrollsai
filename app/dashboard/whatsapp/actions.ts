'use server'

import { createClient } from '@/utils/supabase/server'
import { revalidatePath } from 'next/cache'

export async function disconnectWhatsApp() {
  const supabase = await createClient()

  // 1. Check User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }

  // 2. Clear WhatsApp Fields in Profile
  const { error } = await supabase
    .from('profiles')
    .update({
      whatsapp_access_token: null,
      whatsapp_business_account_id: null,
      whatsapp_phone_number_id: null
    })
    .eq('id', user.id)

  if (error) {
    console.error("Disconnect Error:", error)
    return { error: "Failed to disconnect. Please try again." }
  }

  // 3. Refresh the page data
  revalidatePath('/dashboard/whatsapp')
  return { success: true }
}