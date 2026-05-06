const { convertToModelMessages } = require('ai');

const messages = [
  {
    role: 'user',
    content: 'Generate 5 creative angles'
  }
];

try {
  console.log('Starting conversion...');
  const result = convertToModelMessages(messages);
  console.log('Result:', result);
} catch (e) {
  console.error('Caught error:', e.message);
  console.error(e.stack);
}
