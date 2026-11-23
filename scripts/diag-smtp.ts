/**
 * Raw nodemailer diagnostic for the notification emails.
 *
 * The app logs "[MULTI-CHANNEL EMAIL SUCCESS]" after calling its helpers, but
 * those helpers catch their own errors — so that log can print even on failure.
 * This talks to the SMTP server directly and prints what the server ACTUALLY
 * answered: accepted, rejected, response, messageId.
 */

import nodemailer from 'nodemailer'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

console.log('SMTP_HOST   ', process.env.SMTP_HOST)
console.log('SMTP_PORT   ', process.env.SMTP_PORT)
console.log('SMTP_SECURE ', process.env.SMTP_SECURE)
console.log('SMTP_USER   ', process.env.SMTP_USER)
console.log('SMTP_PASS   ', process.env.SMTP_PASS ? `set (${process.env.SMTP_PASS.length} chars, starts "${process.env.SMTP_PASS.slice(0, 3)}")` : 'MISSING')

async function main() {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: true,
    debug: true,
  })

  console.log('\n=== verify() ===')
  try {
    const ok = await transport.verify()
    console.log('verify ->', ok)
  } catch (e: any) {
    console.log('verify FAILED:', e.message)
    return
  }

  console.log('\n=== sendMail() ===')
  try {
    const info = await transport.sendMail({
      from: '"Nobogent Test" <no-reply@mail.nobogent.com>',
      to: 'infobluesquareinfra@gmail.com',
      subject: 'TEST delivery check - Blue Square Infra alerts',
      text: 'If you can read this, email delivery works. Sent as a raw SMTP test.',
    })
    console.log('accepted :', info.accepted)
    console.log('rejected :', info.rejected)
    console.log('response :', info.response)
    console.log('messageId:', info.messageId)
  } catch (e: any) {
    console.log('sendMail FAILED:', e.message)
    if (e.response) console.log('server response:', e.response)
  }
}

main()
