const str = '🎙️ CALL_JSON:{"recording_url":"https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/lead-voice-recordings/test.wav","turns":2}';
const match = str.match(/(https?:\/\/[^\s]+\.(mp3|m4a|wav|aac|ogg|3gp)|https?:\/\/[^\s]+\/call-recordings\/[^\s]+)/i);
console.log('MATCH:', match ? match[0] : 'NO MATCH');
