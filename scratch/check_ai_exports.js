const ai = require('ai');
console.log('Exports of ai:', Object.keys(ai).filter(k => k.toLowerCase().includes('message')));
