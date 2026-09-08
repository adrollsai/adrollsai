import { spawn } from 'child_process'
// @ts-ignore
import ffmpegPath from 'ffmpeg-static'

/**
 * Ensures an audio buffer is standard 44.1 kHz MPEG-1 Layer III MP3.
 * Vobiz/telephony carriers typically record in 8 kHz MPEG-2.5 MP3 (header starting with 0xFF 0xE2 or 0xFF 0xE3),
 * which Apple iOS Safari / AVFoundation cannot decode, throwing a media decode error on mobile devices.
 */
export async function ensureStandardMp3(inputBuffer: Buffer): Promise<Buffer> {
    if (!inputBuffer || inputBuffer.length < 4) {
        return inputBuffer
    }

    // Check if the buffer is already standard ID3v2 (starts with 'ID3' / 0x49 0x44 0x33)
    const isId3 = inputBuffer[0] === 0x49 && inputBuffer[1] === 0x44 && inputBuffer[2] === 0x33
    // Or standard MPEG-1 Layer III (starts with 0xFF 0xFB or 0xFF 0xFA)
    const isMpeg1L3 = inputBuffer[0] === 0xff && (inputBuffer[1] & 0xfe) === 0xfa

    if (isId3 || isMpeg1L3) {
        return inputBuffer
    }

    // Check if it's MPEG-2.5 Layer 3 (telephony 8kHz audio, sync word 0xFFE2 / 0xFFE3)
    const isMpeg25 = inputBuffer[0] === 0xff && (inputBuffer[1] & 0xfe) === 0xe2

    // If it's not MPEG-2.5 and doesn't look like telephony audio, return as is
    if (!isMpeg25) {
        return inputBuffer
    }

    const binaryPath: string | undefined = (ffmpegPath as any)?.default || ffmpegPath
    if (!binaryPath) {
        console.warn('[AUDIO TRANSCODE] ffmpeg-static path not found, using original buffer')
        return inputBuffer
    }

    return new Promise((resolve) => {
        try {
            const proc: any = spawn(String(binaryPath), [
                '-y',
                '-i', 'pipe:0',
                '-ar', '44100',
                '-b:a', '64k',
                '-f', 'mp3',
                'pipe:1'
            ])

            const chunks: Buffer[] = []
            let stderrOutput = ''

            proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
            proc.stderr?.on('data', (data: Buffer) => {
                stderrOutput += data.toString()
            })

            proc.on('close', (code: number) => {
                if (code === 0 && chunks.length > 0) {
                    const transcoded = Buffer.concat(chunks)
                    console.log(`[AUDIO TRANSCODE] Successfully transcoded ${inputBuffer.length} bytes to ${transcoded.length} bytes (44.1kHz MP3)`)
                    resolve(transcoded)
                } else {
                    console.warn(`[AUDIO TRANSCODE] ffmpeg exited with code ${code}. Error: ${stderrOutput.slice(-200)}`)
                    resolve(inputBuffer)
                }
            })

            proc.on('error', (err: any) => {
                console.warn('[AUDIO TRANSCODE] ffmpeg process error, using original buffer:', err)
                resolve(inputBuffer)
            })

            proc.stdin?.write(inputBuffer)
            proc.stdin?.end()
        } catch (e) {
            console.warn('[AUDIO TRANSCODE] Failed to execute ffmpeg:', e)
            resolve(inputBuffer)
        }
    })
}
