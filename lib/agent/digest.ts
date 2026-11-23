/**
 * The two emails the CEO sends every day.
 *
 * Morning: what it is about to do, what it costs, what it needs from the owner.
 * Evening: what actually happened, what it cost, what is next.
 *
 * Deliberately plain HTML with inline styles — these are read on a phone, in a mail
 * client, by someone who wants three answers in five seconds: did anything happen,
 * is anything waiting on me, what is next. No dashboards, no charts.
 */

export interface DigestItem {
  label: string;
  detail?: string;
  url?: string;
}

export interface DigestInput {
  businessName: string;
  slot: 'morning' | 'eod';
  dateLabel: string;
  /** What was produced / is planned. */
  done?: DigestItem[];
  /**
   * The analysis: where this business is losing money and what we would do about it.
   *
   * This is the part the owner actually bought. It was missing from the email entirely — the
   * findings lived only on the CEO tab — so the twice-daily report arrived without the half of it
   * that says "here is the bottleneck and here is the fix".
   */
  bottlenecks?: DigestItem[];
  /** Approvals or missing inputs the owner must resolve. */
  needsYou?: DigestItem[];
  /** Explicitly skipped, and why. Never omit: silence is what erodes trust. */
  notDone?: DigestItem[];
  /** One line on tomorrow. */
  tomorrow?: string;
  creditsSpent?: number | null;
  creditsLeft?: number | null;
  ceoUrl?: string;
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function section(title: string, items: DigestItem[] | undefined, empty: string, accent: string): string {
  const list = items && items.length ? items : [{ label: empty }];
  const rows = list
    .map(
      (i) => `<tr>
        <td style="padding:7px 0;vertical-align:top;width:12px;color:${accent};font-weight:700;">•</td>
        <td style="padding:7px 0;vertical-align:top;font-size:14px;color:#1f2937;line-height:20px;">
          <span style="font-weight:600;">${esc(i.label)}</span>
          ${i.detail ? `<span style="color:#4b5563;"> — ${esc(i.detail)}</span>` : ''}
          ${i.url ? `<br><a href="${esc(i.url)}" style="color:${accent};font-size:13px;">open</a>` : ''}
        </td>
      </tr>`
    )
    .join('');
  return `<div style="margin:0 0 22px;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;font-weight:700;">${esc(title)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
  </div>`;
}

export function buildDigest(input: DigestInput): { subject: string; html: string; text: string } {
  const accent = input.slot === 'morning' ? '#2563eb' : '#059669';
  const heading =
    input.slot === 'morning'
      ? `Today's plan — ${input.dateLabel}`
      : `Today's wrap — ${input.dateLabel}`;
  const subject =
    input.slot === 'morning'
      ? `${input.businessName}: today's plan (${input.dateLabel})`
      : `${input.businessName}: today's wrap (${input.dateLabel})`;

  const money =
    input.creditsSpent != null || input.creditsLeft != null
      ? `<p style="margin:0 0 18px;font-size:13px;color:#374151;">
           ${input.creditsSpent != null ? `<strong>${input.creditsSpent}</strong> credits spent` : ''}
           ${input.creditsSpent != null && input.creditsLeft != null ? ' · ' : ''}
           ${input.creditsLeft != null ? `<strong>${input.creditsLeft}</strong> left` : ''}
         </p>`
      : '';

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
    <div style="padding:20px 22px;border-bottom:1px solid #eef0f3;">
      <p style="margin:0 0 4px;font-size:12px;color:#6b7280;">${esc(input.businessName)}</p>
      <h1 style="margin:0;font-size:19px;color:#111827;">${esc(heading)}</h1>
    </div>
    <div style="padding:20px 22px;">
      ${money}
      ${section(
        input.slot === 'morning' ? 'What I am doing today' : 'What went out',
        input.done,
        input.slot === 'morning' ? 'nothing planned yet' : 'nothing went out today',
        accent
      )}
      ${section('Where you are losing money, and what I would do', input.bottlenecks, 'nothing measurable is holding you back', '#b45309')}
      ${section('Needs you', input.needsYou, 'nothing — no action needed', accent)}
      ${section('Not done, and why', input.notDone, 'nothing skipped', accent)}
      ${
        input.tomorrow
          ? `<p style="margin:0 0 18px;font-size:14px;color:#1f2937;"><strong>Tomorrow:</strong> ${esc(input.tomorrow)}</p>`
          : ''
      }
      ${
        input.ceoUrl
          ? `<p style="margin:0;"><a href="${esc(input.ceoUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:10px;">Talk to the CEO</a></p>`
          : ''
      }
    </div>
    <div style="padding:14px 22px;border-top:1px solid #eef0f3;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">Sent twice a day. Reply in the app to change anything.</p>
    </div>
  </div>
</body></html>`;

  const text = [
    heading,
    '',
    `${input.slot === 'morning' ? 'DOING' : 'WENT OUT'}:`,
    ...(input.done?.length ? input.done.map((i) => `- ${i.label}${i.detail ? ` — ${i.detail}` : ''}`) : ['- nothing']),
    '',
    'WHERE YOU ARE LOSING MONEY:',
    ...(input.bottlenecks?.length
      ? input.bottlenecks.map((i) => `- ${i.label}${i.detail ? ` — ${i.detail}` : ''}`)
      : ['- nothing measurable']),
    '',
    'NEEDS YOU:',
    ...(input.needsYou?.length ? input.needsYou.map((i) => `- ${i.label}${i.detail ? ` — ${i.detail}` : ''}`) : ['- nothing']),
    '',
    'NOT DONE:',
    ...(input.notDone?.length ? input.notDone.map((i) => `- ${i.label}${i.detail ? ` — ${i.detail}` : ''}`) : ['- nothing']),
    input.tomorrow ? `\nTOMORROW: ${input.tomorrow}` : '',
    input.creditsLeft != null ? `\nCredits left: ${input.creditsLeft}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
