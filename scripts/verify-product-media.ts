/**
 * Proves a product's media is attachable, capped, and legible to the agent.
 *
 * The interesting cases are the refusals. An upload limit that is only enforced in the UI is
 * not a limit — the agent can call the same thing directly — so the rules are pinned here,
 * with the words an owner would actually read.
 *
 *   npm run verify:product-media
 */
import {
  MEDIA_LIMITS,
  checkUpload,
  extensionOf,
  isImageUrl,
  isVideoUrl,
  kindOf,
  mediaBriefForAgent,
  megabytes,
  summariseProductMedia,
  type ProductMediaRow,
} from '../lib/catalog/product-media';
import { productMediaLimits } from '../lib/agent/tools/product-media';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`);

const MB = 1024 * 1024;

head('1. A file is classified by its extension, never guessed');

check(
  'photos, videos and documents are recognised',
  kindOf('shop-front.JPG') === 'image' &&
    kindOf('batch-12.mp4') === 'video' &&
    kindOf('course-brochure.pdf') === 'document' &&
    kindOf('fees.xlsx') === 'document',
  'jpg/mp4/pdf/xlsx',
);
check(
  'an unknown extension is NOT quietly treated as a document',
  kindOf('archive.zip') === null && kindOf('installer.exe') === null && kindOf('noextension') === null,
  'zip, exe and extensionless all rejected',
);
check(
  'the extension is read case-insensitively and from the end',
  extensionOf('Photo.HEIC') === 'heic' && extensionOf('my.file.name.png') === 'png',
  'heic, png',
);

head('2. The size and count caps hold, with a sentence that explains them');

check(
  'a photo under the cap is accepted',
  checkUpload({ name: 'shop.jpg', size: 3 * MB }).ok === true,
  '3 MB photo',
);
check(
  'a photo over 10 MB is refused and says the actual size',
  (() => {
    const verdict = checkUpload({ name: 'huge.jpg', size: 14 * MB });
    return verdict.ok === false && /14 MB/.test(String(verdict.reason)) && /10 MB/.test(String(verdict.reason));
  })(),
  checkUpload({ name: 'huge.jpg', size: 14 * MB }).reason?.slice(0, 70),
);
check(
  'a video over 50 MB is refused with advice, not just a limit',
  (() => {
    const verdict = checkUpload({ name: 'reel.mp4', size: 80 * MB });
    return verdict.ok === false && /Trim it|shorter clip/.test(String(verdict.reason));
  })(),
  checkUpload({ name: 'reel.mp4', size: 80 * MB }).reason?.slice(0, 70),
);
check(
  'the per-product cap counts what is already attached',
  (() => {
    const full = checkUpload({ name: 'b.mp4', size: 5 * MB }, { video: MEDIA_LIMITS.video.maxPerProduct });
    const room = checkUpload({ name: 'b.mp4', size: 5 * MB }, { video: MEDIA_LIMITS.video.maxPerProduct - 1 });
    return full.ok === false && /already has 5 videos/.test(String(full.reason)) && room.ok === true;
  })(),
  `${MEDIA_LIMITS.video.maxPerProduct} videos per product`,
);
check(
  'an unsupported type is refused with the list of what IS accepted',
  (() => {
    const verdict = checkUpload({ name: 'plan.zip', size: MB });
    return verdict.ok === false && /JPG/.test(String(verdict.reason)) && /MP4/.test(String(verdict.reason));
  })(),
  'names the accepted kinds',
);
check(
  'an empty file is refused rather than attached',
  checkUpload({ name: 'empty.png', size: 0 }).ok === false,
  'zero bytes',
);
check(
  'the limits are stated in one line for the prompt',
  productMediaLimits().split(',').length === 3 && /photo/.test(productMediaLimits()),
  productMediaLimits(),
);

head('3. A product\'s media is grouped the way a creative would use it');

const ROWS: ProductMediaRow[] = [
  { id: 'a1', url: 'https://cdn/x/front.jpg', type: 'image', caption: 'Shop front', product_id: 'p1' },
  { id: 'a2', url: 'https://cdn/x/inside.jpg', type: 'image', caption: 'Inside', product_id: 'p1' },
  { id: 'a3', url: 'https://cdn/x/walkthrough.mp4', type: 'video', caption: 'Walkthrough', product_id: 'p1' },
  { id: 'a4', url: 'https://cdn/x/fees.pdf', type: 'document', caption: 'Fee sheet', product_id: 'p1' },
  { id: 'a5', url: 'https://cdn/x/other.jpg', type: 'image', caption: 'Someone else', product_id: 'p2' },
  { id: 'a6', url: 'https://cdn/x/loose.jpg', type: 'image', caption: 'Unattached', product_id: null },
];

const summary = summariseProductMedia('p1', ROWS);
check(
  'only this product\'s files are counted',
  summary.total === 4 &&
    summary.counts.image === 2 &&
    summary.counts.video === 1 &&
    summary.counts.document === 1,
  `${summary.counts.image} photos, ${summary.counts.video} video, ${summary.counts.document} docs`,
);
check(
  'another product and an unattached library file are excluded',
  !summary.images.some((entry) => entry.id === 'a5') && !summary.images.some((entry) => entry.id === 'a6'),
  'p2 and NULL product_id ignored',
);
check(
  'a file with no recorded type is still classified from its URL',
  (() => {
    const loose = summariseProductMedia('p3', [
      { id: 'b1', url: 'https://cdn/x/photo.webp', type: null, caption: '', product_id: 'p3' },
      { id: 'b2', url: 'https://cdn/x/clip.mov', type: null, caption: '', product_id: 'p3' },
    ]);
    return loose.counts.image === 1 && loose.counts.video === 1;
  })(),
  'webp and mov from the URL',
);
check(
  'url sniffing does not claim a query string extension wrongly',
  isImageUrl('https://cdn/x/a.jpg?token=1') && isVideoUrl('https://cdn/x/b.mp4?sig=2') && !isImageUrl('https://cdn/x/report.pdf'),
  'query strings handled',
);

head('4. What the agent is told — and what it is warned about');

const brief = mediaBriefForAgent(summary);
check(
  'the brief says the files exist and to use THEM',
  /4|2 photo/.test(brief) && /Use THESE rather than inventing imagery/.test(brief),
  'first line',
);
check(
  'it lists urls so a creative can reference them',
  /https:\/\/cdn\/x\/front\.jpg/.test(brief) && /walkthrough\.mp4/.test(brief),
  'urls included',
);
check(
  'a product with NO media is warned not to substitute stock silently',
  (() => {
    const empty = summariseProductMedia('p9', []);
    const text = mediaBriefForAgent(empty);
    return /no media attached/.test(text) && /do not substitute a stock image without saying so/i.test(text);
  })(),
  'the honest nudge',
);
check(
  'the list is CAPPED so a product with 35 files cannot flood the prompt',
  (() => {
    const many = summariseProductMedia(
      'p4',
      Array.from({ length: 35 }, (_, index) => ({
        id: `m${index}`,
        url: `https://cdn/x/${index}.jpg`,
        type: 'image',
        caption: `photo ${index}`,
        product_id: 'p4',
      })),
    );
    const text = mediaBriefForAgent(many, { limit: 5 });
    const urls = (text.match(/https:\/\//g) ?? []).length;
    return urls === 5 && /and 30 more/.test(text);
  })(),
  'limit honoured, remainder counted',
);
check(
  'megabytes reads like a person wrote it',
  megabytes(14 * MB) === '14 MB' && megabytes(1.5 * MB) === '1.5 MB',
  `${megabytes(14 * MB)} / ${megabytes(1.5 * MB)}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
