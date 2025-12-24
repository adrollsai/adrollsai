import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    // 1. Initialize Supabase
    const supabase = await createClient();
    
    // 2. Parse Request Body
    const body = await req.json();
    const { callId, phone, name, notes } = body;

    // --- 3. STRICT ENVIRONMENT CHECK ---
    const requiredVars = [
      'EXOTEL_API_KEY', 
      'EXOTEL_API_TOKEN', 
      'EXOTEL_SUBDOMAIN', 
      'EXOTEL_ACCOUNT_SID', 
      'EXOTEL_APP_ID', 
      'EXOTEL_CALLER_ID'
    ];

    const missingVars = requiredVars.filter(key => !process.env[key]);
    if (missingVars.length > 0) {
      console.error(`❌ CRITICAL: Missing .env variables: ${missingVars.join(', ')}`);
      return NextResponse.json({ error: `Server config error: Missing ${missingVars.join(', ')}` }, { status: 500 });
    }

    // --- 4. PREPARE DATA ---
    const apiKey = process.env.EXOTEL_API_KEY!;
    const apiToken = process.env.EXOTEL_API_TOKEN!;
    const subdomain = process.env.EXOTEL_SUBDOMAIN!;
    const accountSid = process.env.EXOTEL_ACCOUNT_SID!;
    const appId = process.env.EXOTEL_APP_ID!;
    const callerId = process.env.EXOTEL_CALLER_ID!;

    // Sanitize phone: Remove spaces, dashes, parentheses. Keep only digits and +.
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    if (cleanPhone.length < 10) {
        return NextResponse.json({ error: "Invalid Phone Number" }, { status: 400 });
    }

    // Context for the callback (Passed via Exotel CustomField)
    const contextData = JSON.stringify({ name, notes, callId });

    // Construct Exotel Flow URL
    // This URL tells Exotel which "Applet" (Flow) to run when the user answers.
    const exotelFlowUrl = `http://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`;

    console.log(`🔍 Preparing Call:`);
    console.log(`   - To User: ${cleanPhone}`);
    console.log(`   - Via Flow: ${exotelFlowUrl}`);
    console.log(`   - Context Length: ${contextData.length} chars`);

    // --- 5. CONSTRUCT FORM DATA ---
    const formData = new URLSearchParams();
    formData.append('From', cleanPhone); 
    formData.append('CallerId', callerId); 
    formData.append('Url', exotelFlowUrl); 
    formData.append('CustomField', contextData);
    
    // NOTE: 'To' is required by the API schema even if 'Url' overrides the logic.
    // We use the customer's number as 'To' as well to satisfy the validator safely.
    formData.append('To', cleanPhone); 
    
    // Optional: CallType. 'trans' = Transactional (bypass DND), 'promo' = Promotional.
    // formData.append('CallType', 'trans'); // Uncomment if you have DLT registration

    // Status Callback to track ringing/answered/completed states
    if (process.env.NEXT_PUBLIC_APP_URL) {
      formData.append('StatusCallback', `${process.env.NEXT_PUBLIC_APP_URL}/api/calling/status`);
    }

    // --- 6. EXECUTE API CALL ---
    const exotelApiUrl = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/connect`;
    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:${apiToken}`).toString('base64');

    const response = await fetch(exotelApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded' 
      },
      body: formData
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`❌ Exotel API Failed [${response.status}]:`);
      console.error(responseText);
      return NextResponse.json({ error: responseText }, { status: response.status });
    }

    // --- 7. EXTRACT SID & UPDATE DB (CRITICAL FIX) ---
    // We parse the XML response to get the SID immediately.
    // XML format: <TwilioResponse><Call><Sid>...</Sid></Call></TwilioResponse>
    let exotelCallSid = null;
    const sidMatch = responseText.match(/<Sid>(.*?)<\/Sid>/);
    if (sidMatch && sidMatch[1]) {
        exotelCallSid = sidMatch[1];
    }

    console.log(`✅ Call Initiated. DB ID: ${callId} | Exotel SID: ${exotelCallSid}`);

    // Update DB with STATUS AND SID
    const { error: dbError } = await supabase
      .from('calls')
      .update({ 
          status: 'calling',
          exotel_call_sid: exotelCallSid // Save this! Critical for status updates.
      })
      .eq('id', callId);

    if (dbError) {
      console.error("⚠️ Failed to update DB status:", dbError);
    }

    return NextResponse.json({ success: true, exotelResponse: responseText });

  } catch (error: any) {
    console.error('❌ Internal Trigger Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}