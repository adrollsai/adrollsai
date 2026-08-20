const XLSX = require('xlsx');

function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str) return null;
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return null;
  const [, day, month, year, hourRaw, minute, ampm] = match;
  let hour = parseInt(hourRaw);
  if (ampm.toLowerCase() === 'pm' && hour !== 12) hour += 12;
  if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
  const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00+05:30`;
  try {
    const dt = new Date(isoStr);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  } catch { return null; }
}

function parseFollowups(fText, ownerName) {
  if (!fText || typeof fText !== 'string') return [];
  const entries = [];
  const parts = fText.split(/(?=(?:Call|Call Not Picked|WhatsApp|Email|SMS|Visit|Revisit|Home Meeting|Closing Meeting|Meeting|Note)\s*·\s*\d)/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([^\n·]+)\s*·\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm))\s*\n?([\s\S]*)/i);
    if (match) {
      const [, act, dateStr, rem] = match;
      const actClean = act.trim();
      const isDnp = actClean.toLowerCase().includes('not picked') || actClean.toLowerCase().includes('dnp');
      const isVisit = actClean.toLowerCase().includes('visit');
      const isMeeting = actClean.toLowerCase().includes('meeting');
      const actionType = isDnp ? 'DNP' : isVisit ? 'SITE_VISIT' : isMeeting ? 'MEETING' : 'CALL_FEEDBACK';
      
      const desc = `Follow up Type : ${actClean}\nFollowup Date : ${dateStr.trim()}${rem.trim() ? '\nRemarks : ' + rem.trim() : ''}\n[by ${ownerName || 'Shubha Baweja Gulati'}]`;
      
      entries.push({
        action_type: actionType,
        description: desc,
        created_at: parseDate(dateStr),
        raw_date: dateStr.trim()
      });
    }
  }
  return entries;
}

const wb1 = XLSX.readFile('C:\\Users\\Adrolls\\Downloads\\shubha_leads.xlsx');
const r1 = XLSX.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0]]).find(r => String(r['Contacts']).includes('9646060175'));

const wb2 = XLSX.readFile('C:\\Users\\Adrolls\\Downloads\\leads_history_combined.csv');
const r2 = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]]).find(r => String(r['Contacts']).includes('9646060175'));

const items = [];
if (r2) {
  items.push(...parseFollowups(r2['Followups'], r2['Lead Owner'] || 'Shubha Baweja Gulati'));
}

const lastRem = r1['Last Remarks'] || '';
const meetDate = r1['Meeting Date'] || '';
if (meetDate && !items.some(it => it.raw_date === meetDate.trim())) {
  const isDnp = lastRem.toLowerCase().includes('not picked') || lastRem.toLowerCase().includes('dnp');
  const actClean = isDnp ? 'Call Not Picked' : 'Call';
  const actionType = isDnp ? 'DNP' : 'CALL_FEEDBACK';
  const remText = lastRem.replace(/^(Call\s+(?:Not\s+Picked\s+)?on\s+[^\n]+\s*)/i, '').trim();
  
  let desc = `Follow up Type : ${actClean}\nFollowup Date : ${meetDate.trim()}`;
  if (r1['Next Followup Date']) desc += `\nNext Action Date : ${r1['Next Followup Date']}`;
  if (r1['Next Followup']) desc += `\nNext Action : Call`;
  if (remText) desc += `\nRemarks : ${remText}`;
  desc += `\n[by ${r1['Lead Owner'] || 'Shubha Baweja Gulati'}]`;

  items.push({
    action_type: actionType,
    description: desc,
    created_at: parseDate(meetDate),
    raw_date: meetDate.trim()
  });
}

if (r1['Created Date']) {
  let createdDesc = `New Lead created\nLead Owner : ${r1['Lead Owner'] || 'Shubha Baweja Gulati'}\nLead Name : ${r1['Lead Name'] || ''}\nContact no : ${r1['Contacts'] || ''}\nLead Source : ${r1['Lead Source'] || ''}`;
  if (r1['Source Details']) createdDesc += `\nSource Details : ${r1['Source Details']}`;
  createdDesc += `\nLead Status : ${r1['Lead Status'] || 'New Lead'}`;
  if (r1['Openning Remarks']) {
    const cleanOpening = r1['Openning Remarks'].replace(/<br\s*\/?>/gi, '\n').trim();
    createdDesc += `\nOpening Remarks :\n${cleanOpening}`;
  }
  createdDesc += `\n[by System]`;

  items.push({
    action_type: 'LEAD_CREATED',
    description: createdDesc,
    created_at: parseDate(r1['Created Date']),
    raw_date: r1['Created Date']
  });
}

items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

console.log('Total Charanjot timeline items:', items.length);
items.forEach((it, i) => {
  console.log(`\n[${i + 1}] ${it.action_type} | ${it.raw_date}`);
  console.log(it.description);
});
