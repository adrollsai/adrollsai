const crypto = require('crypto');

const url1 = "https://dvygrupphzjitzbrtlve.supabase.co/storage/v1/object/public/logos/character-c890a11f-84ce-4592-ab8f-8682927b1a9d-1780468110459.mp4";
const url2 = "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/library/c890a11f-84ce-4592-ab8f-8682927b1a9d/1781854790292-videoad.mp4";

console.log("Hash 1:", crypto.createHash('md5').update(url1).digest('hex'));
console.log("Hash 2:", crypto.createHash('md5').update(url2).digest('hex'));
