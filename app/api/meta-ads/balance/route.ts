import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_URL = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, ad_account_id')
        .eq('id', user.id)
        .single();

    if (!profile?.facebook_token || !profile?.ad_account_id) {
        return NextResponse.json({ balance: 0, currency: 'INR', error: "No Ad Account Linked" });
    }

    // Fetch Balance from Meta
    const res = await fetch(
      `${FB_URL}/${profile.ad_account_id}?fields=balance,currency,account_status,disable_reason&access_token=${profile.facebook_token}`
    );
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    // Meta returns balance in cents (e.g. 1500 = 15.00)
    // BUT we need to check if it's prepaid or postpaid.
    // Usually 'balance' field represents "Amount Spent" for postpaid or "Remaining" for prepaid?
    // Actually, for prepaid accounts in India, 'balance' usually returns 0 if they owe nothing, 
    // or we might need to check 'funding_source_details'.
    // A more reliable check for "Funds Available" is tricky in API, but 'balance' shows amount due.
    // Let's rely on user clicking "Top Up" which goes to billing.
    
    // For simplicity in display, we will just return what Meta says, but usually users want to see "Prepaid Balance".
    // That is often not directly exposed easily. 
    // Let's return the `balance` field which is "Current Balance" (Amount Due or Credit).
    
    return NextResponse.json({ 
        balance: data.balance, // This is usually "Amount Due"
        currency: data.currency,
        status: data.account_status 
    });

  } catch (error: any) {
    console.error("Balance Fetch Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}