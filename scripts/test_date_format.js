const utcIso = '2026-08-11T13:59:00.000Z';
const dateObj = new Date(utcIso);

console.log('UTC String:', utcIso);
console.log('Default toLocaleString:', dateObj.toLocaleString());
console.log('IST toLocaleString:', dateObj.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
console.log('IST Formatted:', dateObj.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }));
