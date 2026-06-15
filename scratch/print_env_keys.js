console.log("Environment keys:");
console.log(Object.keys(process.env).filter(k => k.toLowerCase().includes('db') || k.toLowerCase().includes('postgres') || k.toLowerCase().includes('sql') || k.toLowerCase().includes('url') || k.toLowerCase().includes('conn')));
