import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HOMCOM_USER_ID = '9bbf6e51-283e-48d1-bbb4-8dc546cc74b2'
const AUDIENCE = 'List of buyer - list'

async function analyzePhones() {
  const { data: leads } = await supabase
    .from('leads')
    .select('id, name, phone, email')
    .eq('user_id', HOMCOM_USER_ID)
    .eq('csv_audience', AUDIENCE)
    .order('created_at', { ascending: true })

  console.log('Total leads fetched:', leads?.length)

  const seenPhones = new Set<string>()
  const validLeads: any[] = []
  const invalidLeads: any[] = []

  for (const l of leads || []) {
    let raw = (l.phone || '').replace(/\D/g, '')
    // If starts with 91 and 12 digits, good. If 10 digits, add 91. If 11 digits starting with 0, strip 0 and add 91.
    let clean = raw
    if (clean.startsWith('0') && clean.length === 11) {
      clean = clean.slice(1)
    }
    if (clean.length === 10) {
      clean = '91' + clean
    }

    if (clean.length >= 10 && clean.length <= 15) {
      if (!seenPhones.has(clean)) {
        seenPhones.add(clean)
        validLeads.push({ ...l, cleanPhone: clean })
      } else {
        console.log('Duplicate phone skipped:', clean, l.name)
      }
    } else {
      invalidLeads.push({ ...l, rawPhone: l.phone })
    }
  }

  console.log(`Unique valid phone leads: ${validLeads.length}`)
  console.log(`Invalid phone leads: ${invalidLeads.length}`)
  if (invalidLeads.length > 0) {
    console.log('Sample invalid leads:', invalidLeads.slice(0, 5))
  }
}

analyzePhones().then(() => process.exit(0)).catch(console.error)
