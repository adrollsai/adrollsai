// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/check-status/route.ts

import { NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2'
import { enforceFrame } from '@/lib/media/frame'
import { normaliseImageRatio, FRAME_BY_RATIO } from '@/lib/agent/media-ratios'

/**
 * The app's image status proxy — and the place the DELIVERED ratio is made true.
 *
 * This route used to be a dumb passthrough of the provider's recordInfo JSON. The Creation tab polls it,
 * takes the URL out of the response and shows it, so whatever the model returned is what the owner sees.
 * That is how a creative generated with 4:5 selected arrived as a LANDSCAPE image: the request asked the
 * provider for `auto` and stated the frame in words inside the prompt (see lib/agent/media-ratios), and
 * the model ignored the words.
 *
 * So when a task succeeds AND the caller says which ratio it asked for, the finished image is fetched once,
 * cropped to that exact frame (`lib/media/frame`), re-uploaded to our own storage, and the URL in the
 * response is replaced with the framed copy. The client needs no change beyond passing `ratio`.
 *
 * Everything stays backwards compatible: no `ratio` means the old passthrough behaviour, and a crop failure
 * returns the provider's image rather than nothing.
 */
export async function POST(request: Request) {
  const body = await request.json()
  const { taskId, ratio } = body

  if (!taskId) {
    return NextResponse.json({ error: 'Missing taskId' }, { status: 400 })
  }

  try {
    const response = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KIE_API_KEY}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Kie API Error: ${response.statusText}`)
    }

    const data = await response.json()

    // Only touch a FINISHED image task that the caller told us the frame for.
    const wantsFrame = typeof ratio === 'string' && ratio.trim().length > 0
    if (wantsFrame) {
      const state = data?.data?.state || data?.state || ''
      const succeeded = /success|succeeded|completed/i.test(String(state))
      if (succeeded) {
        const urls = collectImageUrls(data)
        if (urls.length > 0) {
          const resolved = normaliseImageRatio(ratio)
          const framedUrl = await frameAndPersist(urls[0], resolved, taskId)
          if (framedUrl) {
            replaceUrls(data, urls[0], framedUrl)
            console.log(
              `[check-status] task ${taskId} framed to ${resolved} (${FRAME_BY_RATIO[resolved].width}x${FRAME_BY_RATIO[resolved].height})`
            )
          }
        }
      }
    }

    return NextResponse.json(data)

  } catch (error: any) {
    console.error("Check Status Error:", error)
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 })
  }
}

/** Every place these responses put a result image, across provider versions. */
function collectImageUrls(data: any): string[] {
  const found: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) found.push(value)
  }

  push(data?.data?.result?.image_url)
  push(data?.data?.result?.output_url)
  push(data?.data?.result?.url)
  push(data?.result?.image_url)
  push(data?.result?.url)

  const resultJson = data?.data?.resultJson
  if (typeof resultJson === 'string') {
    try {
      const parsed = JSON.parse(resultJson)
      for (const url of parsed?.resultUrls || []) push(url)
      push(parsed?.url)
    } catch {
      /* not JSON — the other fields already covered it */
    }
  }

  return Array.from(new Set(found))
}

/** Swap one URL for another wherever it appears in the response. */
function replaceUrls(node: any, from: string, to: string): void {
  if (!node || typeof node !== 'object') return
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (typeof value === 'string') {
      if (value === from) node[key] = to
      else if (value.includes(from)) node[key] = value.split(from).join(to)
    } else if (typeof value === 'object') {
      replaceUrls(value, from, to)
    }
  }
}

/**
 * Fetch the provider's image, crop it to the frame and persist it. Returns the new URL, or null when the
 * original should stand (a 16 MB image, an unreadable file, a storage outage — none of which should cost
 * the owner their creative).
 */
async function frameAndPersist(sourceUrl: string, ratio: string, taskId: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) return null
    const raw = Buffer.from(await res.arrayBuffer())
    if (raw.byteLength === 0 || raw.byteLength > 20 * 1024 * 1024) return null

    const framed = await enforceFrame(raw, ratio)
    const key = `ai_images/framed/${ratio.replace(':', 'x')}/${taskId}.jpg`

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: framed.buffer,
        ContentType: framed.contentType,
      })
    )

    return `${R2_PUBLIC_URL}/${key}`
  } catch (error: any) {
    console.warn(`[check-status] could not frame task ${taskId}: ${error?.message || error}`)
    return null
  }
}
