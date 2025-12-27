import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', 
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

export async function sendDistributionEmail(to: string, agentName: string, imageUrl: string, senderName: string) {
  try {
    const info = await transporter.sendMail({
      from: `"${senderName}" <${process.env.SMTP_USER}>`,
      to: to,
      subject: `New Marketing Asset for ${agentName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Hello ${agentName},</h2>
          <p>Here is your new personalized marketing graphic from <strong>${senderName}</strong>.</p>
          <p>You can download it below and share it immediately.</p>
          <br/>
          <a href="${imageUrl}" style="display: inline-block; padding: 12px 24px; background-color: #000; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">Download Graphic</a>
          <br/><br/>
          <img src="${imageUrl}" alt="Preview" style="width: 100%; border-radius: 8px; border: 1px solid #eee;" />
        </div>
      `,
    })
    return { success: true, messageId: info.messageId }
  } catch (error: any) {
    console.error("Email Error:", error)
    return { success: false, error: error.message }
  }
}