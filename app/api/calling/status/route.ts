import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Define the shape of data we expect from Exotel
interface ExotelStatusPayload {
  CallSid?: string;
  Status?: string;
  RecordingUrl?: string;
  DateUpdated?: string;
  CustomField?: string;
  [key: string]: any; 
}

export async function POST(req: Request) {
  // --- 1. SETUP DATABASE CLIENT (ADMIN) ---
  // We use the Service Role Key to bypass Row Level Security (RLS).
  // This is crucial because Exotel's webhook comes from a server, not a logged-in user.
  // Using standard createClient from 'server' might fail due to lack of cookies.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log("📨 [Status Webhook] Received request from Exotel.");

  try {
    // --- 2. ROBUST BODY PARSING ---
    // Exotel usually sends 'application/x-www-form-urlencoded', but sometimes headers vary.
    // We try all methods to ensure we never miss the data.
    let payload: ExotelStatusPayload = {};
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        formData.forEach((value, key) => {
            payload[key] = value.toString();
        });
    } else {
      // Fallback: Read raw text and parse search params (safest for standard form-urlencoded)
      const text = await req.text();
      const params = new URLSearchParams(text);
      params.forEach((value, key) => {
        payload[key] = value;
      });
    }

    const { CallSid, Status, CustomField } = payload;
    
    console.log(`📋 [Status Webhook] Processed Data:`, { 
        SID: CallSid, 
        Status: Status, 
        HasCustomField: !!CustomField 
    });

    // --- 3. STATUS MAPPING ---
    // Exotel Statuses: 'queued', 'ringing', 'in-progress', 'completed', 'failed', 'busy', 'no-answer', 'canceled'
    // DB Statuses: 'pending', 'calling', 'completed', 'failed'
    
    let dbStatus = 'pending';
    
    // Determine the final status to save
    if (Status === 'completed') {
        dbStatus = 'completed';
    } else if (['failed', 'busy', 'no-answer', 'canceled'].includes(Status || '')) {
        dbStatus = 'failed';
    } else {
        // If it's an intermediate status (ringing, in-progress), we log it but don't close the call in DB.
        console.log(`ℹ️ [Status Webhook] Intermediate status '${Status}'. Ignoring DB update.`);
        return NextResponse.json({ received: true, ignored: true });
    }

    // --- 4. UPDATE DATABASE ---
    let updateSuccess = false;

    // STRATEGY A: Use the Internal ID from CustomField (Most Reliable)
    if (CustomField) {
      try {
        // Handle potential double-encoding quirks from telephony providers
        let jsonStr = CustomField;
        // Check if it looks URL encoded (starts with %7B for '{')
        if (jsonStr.includes('%7B') || jsonStr.includes('%7D')) {
            jsonStr = decodeURIComponent(jsonStr);
        }

        const data = JSON.parse(jsonStr);
        
        if (data.callId) {
          console.log(`🔄 [Status Webhook] Updating Call via ID: ${data.callId} -> ${dbStatus}`);
          
          const { error } = await supabase
            .from('calls')
            .update({ 
                status: dbStatus,
                exotel_call_sid: CallSid // Save SID for future reference if not present
            })
            .eq('id', data.callId);

          if (error) {
            console.error("❌ [Status Webhook] DB Update Failed (ID strategy):", error);
          } else {
            console.log("✅ [Status Webhook] DB Updated Successfully (ID strategy).");
            updateSuccess = true;
          }
        }
      } catch (e) {
        console.error("⚠️ [Status Webhook] Failed to parse CustomField JSON:", e);
        console.error("   Raw CustomField:", CustomField);
      }
    }

    // STRATEGY B: Fallback to Exotel CallSid
    // This runs if Strategy A failed (e.g. invalid JSON) or if CustomField was missing.
    // Note: This only works if we saved the CallSid during the Trigger phase (which we didn't always do),
    // but it's a good safety net for future calls.
    if (!updateSuccess && CallSid) {
       console.log(`🔄 [Status Webhook] Attempting Fallback Update via CallSid: ${CallSid}`);
       
       const { data, error } = await supabase
         .from('calls')
         .update({ status: dbStatus })
         .eq('exotel_call_sid', CallSid)
         .select(); 
         
       if (error) {
           console.error("❌ [Status Webhook] DB Update Failed (Sid strategy):", error);
       } else if (data && data.length > 0) {
           console.log("✅ [Status Webhook] DB Updated Successfully (Sid strategy).");
       } else {
           console.warn("⚠️ [Status Webhook] No matching call found for this CallSid. (This is normal if ID update succeeded)");
       }
    }

  } catch (error: any) {
    console.error("🔥 [Status Webhook] Critical Error:", error.message);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Handle GET requests (sometimes used for manual verification)
export async function GET(req: Request) {
    return POST(req);
}