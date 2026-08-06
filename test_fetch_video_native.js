const https = require('https');

const urls = [
  "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785836248386.mp4",
  "https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/generated/42d2e0c5-4fe6-4738-8a9f-63f09be01f12/stitched_1785836248386.mp4",
  "https://app.nobogent.com/api/fetch-image?url=https%3A%2F%2Fpub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev%2Fgenerated%2F42d2e0c5-4fe6-4738-8a9f-63f09be01f12%2Fstitched_1785836248386.mp4"
];

urls.forEach(url => {
  https.get(url, { method: 'HEAD' }, (res) => {
    console.log(`URL: ${url}\nStatus Code: ${res.statusCode}\nContent-Type: ${res.headers['content-type']}\n`);
  }).on('error', (e) => {
    console.error(`URL: ${url}\nError: ${e.message}\n`);
  });
});
