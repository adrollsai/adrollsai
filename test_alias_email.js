const nodemailer = require('nodemailer');

const host = 'smtp.hostinger.com';
const port = 465;
const secure = true;
const user = 'info@nobogent.com';
const pass = 'Manu@687399';

console.log('=== VERIFYING ALIAS EMAIL DISPATCH ===');
console.log(`Host:    ${host}`);
console.log(`Port:    ${port}`);
console.log(`Secure:  ${secure}`);
console.log(`User:    ${user}`);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass }
});

async function run() {
  console.log('\nSending test email from alias no-reply@nobogent.com to rchopra489@gmail.com...');
  
  const info = await transporter.sendMail({
    from: '"Nobogent Verification" <no-reply@nobogent.com>',
    to: 'rchopra489@gmail.com',
    subject: '🔥 Hostinger Alias Test - Nobogent AI',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #003D6F; margin: 0; padding-bottom: 12px; border-bottom: 2px solid #003D6F;">Hostinger Alias Verification</h2>
        </div>
        <p style="font-size: 16px; color: #334155; line-height: 1.5;">Hello,</p>
        <p style="font-size: 15px; color: #475569; line-height: 1.5;">
          This test email was successfully sent from your alias <strong>no-reply@nobogent.com</strong> by authenticating as <strong>info@nobogent.com</strong>!
        </p>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #16a34a; font-weight: bold;">
            ✅ Hostinger Alias SMTP authenticated and delivered successfully!
          </p>
        </div>
        <p style="font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px;">
          Sent automatically by Nobogent AI Verification Runner
        </p>
      </div>
    `
  });
  
  console.log('\n======================================');
  console.log('✅ TEST ALIAS EMAIL SENT SUCCESSFULLY!');
  console.log(`- Message ID: ${info.messageId}`);
  console.log(`- Response:   ${info.response}`);
  console.log('======================================');
}

run().catch(err => {
  console.error('\n======================================');
  console.error('❌ ALIAS EMAIL DISPATCH FAILED!');
  console.error(`Error Code: ${err.code}`);
  console.error(`Command:    ${err.command}`);
  console.error(`Message:    ${err.message}`);
  console.error('======================================');
});
