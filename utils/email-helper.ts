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

// Original Function (Keep this)
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

// NEW FUNCTION: Send Lead Notification
export async function sendLeadEmail(to: string, agentName: string, leadName: string, leadPhone: string, source: string) {
    try {
      console.log(`📧 Attempting to send email to ${to}...`);
      const info = await transporter.sendMail({
        from: `"AdRolls AI" <${process.env.SMTP_USER}>`,
        to: to,
        subject: `🎯 New Lead Alert: ${leadName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #0f172a; padding: 20px; text-align: center;">
                <h2 style="color: #ffffff; margin: 0;">New Lead Received!</h2>
            </div>
            <div style="padding: 24px;">
                <p style="color: #64748b; font-size: 14px; margin-bottom: 8px;">Hello ${agentName},</p>
                <p style="color: #1e293b; font-size: 16px; margin-top: 0;">You have a new lead from <strong>${source}</strong>.</p>
                
                <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 24px 0;">
                    <p style="margin: 0 0 8px 0; font-size: 14px; color: #64748b;"><strong>Name:</strong> <span style="color: #0f172a;">${leadName}</span></p>
                    <p style="margin: 0; font-size: 14px; color: #64748b;"><strong>Phone:</strong> <a href="tel:${leadPhone}" style="color: #2563eb; font-weight: bold; text-decoration: none;">${leadPhone}</a></p>
                </div>
  
                <p style="font-size: 14px; color: #64748b;">Login to your CRM to view full details and update the status.</p>
                
                <div style="text-align: center; margin-top: 24px;">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/crm" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 14px;">View in CRM</a>
                </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 12px; text-align: center; font-size: 12px; color: #94a3b8;">
                Powered by AdRolls AI
            </div>
          </div>
        `,
      })
      console.log(`📧 Email Sent ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId }
    } catch (error: any) {
      console.error("Email Error:", error)
      return { success: false, error: error.message }
    }
  }