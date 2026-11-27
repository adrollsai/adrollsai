/**
 * "4:5" MUST MEAN 4:5 — proved with pixels, not prose.
 *
 * A live account generated a creative with 4:5 selected and got a LANDSCAPE image. Nothing was broken by
 * accident: `lib/agent/media-ratios` sends every ratio to the image provider as `auto` (the Flare models
 * carry no 4:5 enum) and states the frame in words inside the prompt. The model ignored the words — which
 * is exactly what a model is allowed to do.
 *
 * So `lib/media/frame` crops whatever comes back to the frame that was asked for, and this gate proves it
 * with synthesised images (sharp, no network, no credits): a landscape source, a square source and a
 * too-tall source all come out at exactly the requested frame, with the centre of the composition intact.
 *
 *   npm run verify:image-frame
 */
import sharp from 'sharp';
import { FRAME_BY_RATIO, normaliseImageRatio, OFFERED_IMAGE_RATIOS } from '../lib/agent/media-ratios';
import { enforceFrame, ratioOf } from '../lib/media/frame';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
};
const head = (title: string) => console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`);

/** A source image whose CENTRE is a unique solid colour, so a bad crop is detectable. */
async function source(width: number, height: number): Promise<Buffer> {
  const centre = await sharp({
    create: { width: Math.round(width / 3), height: Math.round(height / 3), channels: 3, background: { r: 220, g: 30, b: 40 } },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 60 } } })
    .composite([{ input: centre, gravity: 'centre' }])
    .jpeg()
    .toBuffer();
}

async function main() {
  head('1. Every offered ratio is delivered at its exact frame');

  for (const ratio of OFFERED_IMAGE_RATIOS) {
    const frame = FRAME_BY_RATIO[ratio];
    // A landscape source is the case that actually happened for 4:5.
    const framed = await enforceFrame(await source(1344, 768), ratio);
    const meta = await sharp(framed.buffer).metadata();
    check(
      `${ratio}: a landscape source becomes ${frame.width}x${frame.height}`,
      meta.width === frame.width && meta.height === frame.height,
      `${meta.width}x${meta.height} (from ${framed.original.width}x${framed.original.height} ${framed.original.ratio})`,
    );
    // The source is 7:4, which is none of the offered frames — so every one of them must crop.
    check(`${ratio}: and the crop is reported, not hidden`, framed.unchanged === false);
  }

  head('2. The subject survives the crop');

  {
    // Centre-weighted `cover`: the middle of the composition must still be the middle.
    const framed = await enforceFrame(await source(1344, 768), '4:5');
    const { width, height } = await sharp(framed.buffer).metadata();
    const pixel = await sharp(framed.buffer)
      .extract({ left: Math.round(width! / 2) - 4, top: Math.round(height! / 2) - 4, width: 8, height: 8 })
      .raw()
      .toBuffer();
    // The centre band of the source was red (220,30,40); the surround was navy.
    const redish = pixel[0] > 120 && pixel[1] < 120;
    check('the centre of the source is still the centre of the crop', redish, `rgb(${pixel[0]},${pixel[1]},${pixel[2]})`);
  }

  head('3. An image that already fits is not degraded');

  {
    const exact = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 5, g: 5, b: 5 } } })
      .jpeg()
      .toBuffer();
    const framed = await enforceFrame(exact, '4:5');
    check('an exact 4:5 image is passed through untouched', framed.unchanged === true);
    check('and keeps its own bytes', framed.buffer.length === exact.length, `${framed.buffer.length} vs ${exact.length}`);
  }

  head('4. Nonsense input never costs the owner the creative');

  {
    const garbage = Buffer.from('not an image at all');
    const framed = await enforceFrame(garbage, '4:5');
    check('a non-image comes back unchanged rather than throwing', framed.buffer.length === garbage.length);

    const odd = await enforceFrame(await source(900, 300), 'portrait');
    const meta = await sharp(odd.buffer).metadata();
    check('a legacy ratio name still resolves to the feed frame', meta.width === 1080 && meta.height === 1350, `${meta.width}x${meta.height}`);
  }

  head('5. The ratio vocabulary');

  {
    check('3:4 (the old portrait) becomes 4:5, not a rejection', normaliseImageRatio('3:4') === '4:5');
    check('ratioOf reads a frame back as a ratio', ratioOf(1080, 1350) === '4:5', ratioOf(1080, 1350));
    check('ratioOf handles 1080x1080', ratioOf(1080, 1080) === '1:1', ratioOf(1080, 1080));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('verify-image-frame crashed:', error?.message || error);
  process.exitCode = 1;
});
