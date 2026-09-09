const { checkStatus } = require('./check_khushi_template_status');
const { sendTestMessage } = require('./send_khushi_test_message');

async function waitAndSend() {
  console.log('Polling Meta for template approval...');
  let attempts = 0;
  const maxAttempts = 25; // 25 * 8s = ~200s

  while (attempts < maxAttempts) {
    attempts++;
    const status = await checkStatus();
    if (status === 'APPROVED') {
      console.log('\n🎉 Template is APPROVED by Meta! Triggering test send now...');
      await sendTestMessage();
      return;
    } else if (status === 'REJECTED') {
      console.error('\n❌ Template was REJECTED by Meta.');
      return;
    }
    console.log(`[Attempt ${attempts}/${maxAttempts}] Status is still ${status}. Checking again in 8 seconds...`);
    await new Promise(r => setTimeout(r, 8000));
  }

  console.log('Timed out waiting for approval. Please check back shortly.');
}

waitAndSend().catch(console.error);
