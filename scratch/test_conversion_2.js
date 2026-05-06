const { convertToModelMessages } = require('ai');

const messages = [
  {
    role: 'user',
    content: 'Generate 5 creative angles',
    parts: undefined // This might cause .filter( on parts if it tries to filter parts
  }
];

try {
  console.log('Starting conversion...');
  const result = convertToModelMessages(messages);
  console.log('Result:', result);
} catch (e) {
  console.error('Caught error:', e.message);
}
