import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const customField = searchParams.get('CustomField');
  
  let contextData = { name: 'Valued Customer', notes: 'General inquiry' };

  // 1. Extract Context from Exotel Trigger
  try {
    if (customField) {
      // Exotel might double-encode or pass raw JSON
      let jsonStr = customField;
      if (jsonStr.includes('%7B')) jsonStr = decodeURIComponent(jsonStr);
      
      const parsed = JSON.parse(jsonStr);
      contextData = { 
        name: parsed.name || 'Valued Customer', 
        notes: parsed.notes || 'General inquiry' 
      };
      
      console.log("✅ Callback Parsed:", contextData);
    }
  } catch (e) {
    console.error("❌ Context Parse Error:", e);
  }

  // 2. ENCODE CONTEXT INTO URL PATH (Base64)
  // This is the fix. We don't use ?name= anymore.
  const jsonString = JSON.stringify(contextData);
  const base64Context = Buffer.from(jsonString).toString('base64')
    .replace(/\+/g, '-') // Convert to URL-safe Base64
    .replace(/\//g, '_')
    .replace(/=+$/, ''); 

  // Get WebSocket URL and remove trailing slash if present
  const RENDER_WEBSOCKET_URL = process.env.RENDER_WEBSOCKET_URL?.replace(/\/$/, '');
  
  // Construct new URL: wss://host/media-stream/BASE64_DATA
  const streamUrl = `${RENDER_WEBSOCKET_URL}/${base64Context}`;

  console.log("➡️ GENERATED ROBUST URL:", streamUrl);

  return NextResponse.json({ url: streamUrl });
}

export async function POST(req: Request) { return GET(req); }