/**
 * Watch what Meta thinks of our live ads.
 *
 * WHY THIS EXISTS
 * A campaign can be created successfully and then be unpublishable. Meta reports
 * that on the object itself, in `issues_info` — and nothing in this platform ever
 * read it. Blue Square Infra's ad set 120247466552430424 sat WITH_ISSUES on
 * "Advantage+ audience is not available … in this special ad category" for three
 * days; the client found out by trying to publish, not because we told them. The
 * same account currently carries an ad with "Invalid creative for objective"
 * (1487891) and a second ad set with "Special Ad Category errors" (2909035).
 *
 * This module is pure: rows in, an alert decision out. The route that calls it only
 * does the Graph reads and the notification inserts.
 */

/** What Meta calls "you cannot deliver this" on a campaign, ad set or ad. */
export const BLOCKING_STATUSES = ['WITH_ISSUES', 'DISAPPROVED'] as const;
export type BlockingStatus = (typeof BLOCKING_STATUSES)[number];

export interface MetaIssueInfo {
  level?: string;
  error_code?: number | string;
  error_summary?: string;
  error_message?: string;
}

export interface MetaObjectWithIssues {
  id: string;
  name?: string;
  /** campaigns | adsets | ads */
  edge: 'campaigns' | 'adsets' | 'ads';
  effective_status?: string;
  issues_info?: MetaIssueInfo[];
}

export interface BlockingIssue {
  edge: 'campaigns' | 'adsets' | 'ads';
  id: string;
  name: string;
  status: string;
  code: string;
  summary: string;
  message: string;
  /** Stable identity for de-duplication: the same problem must not alert twice a day. */
  key: string;
}

const EDGE_LABEL: Record<BlockingIssue['edge'], string> = {
  campaigns: 'campaign',
  adsets: 'ad set',
  ads: 'ad',
};

/** True when a status means the object cannot deliver right now. */
export function isBlockingStatus(status: unknown): status is BlockingStatus {
  return BLOCKING_STATUSES.includes(String(status || '').toUpperCase() as BlockingStatus);
}

/**
 * Flatten everything Meta complained about into one list.
 *
 * Objects whose status is not blocking are ignored even if they carry issues_info:
 * Meta attaches advisory issues to healthy objects too, and alerting on those would
 * train the reader to ignore the alert.
 */
export function collectBlockingIssues(objects: MetaObjectWithIssues[]): BlockingIssue[] {
  const out: BlockingIssue[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const status = String(object.effective_status || '').toUpperCase();
    if (!isBlockingStatus(status)) continue;
    const issues = object.issues_info?.length
      ? object.issues_info
      : [{ error_summary: `Object is ${status.toLowerCase().replace(/_/g, ' ')}`, error_message: '' }];
    for (const issue of issues) {
      const code = String(issue.error_code ?? 'unknown');
      const key = `${object.edge}:${object.id}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        edge: object.edge,
        id: object.id,
        name: String(object.name || object.id),
        status,
        code,
        summary: String(issue.error_summary || 'Meta reported an issue'),
        message: String(issue.error_message || ''),
        key,
      });
    }
  }
  return out;
}

/** Group by the account that owns them, so one notification per client. */
export function groupByAccount(
  issues: BlockingIssue[],
  accountOf: (edge: BlockingIssue['edge'], id: string) => string | undefined
): Map<string, BlockingIssue[]> {
  const grouped = new Map<string, BlockingIssue[]>();
  for (const issue of issues) {
    const account = accountOf(issue.edge, issue.id);
    if (!account) continue;
    const list = grouped.get(account) || [];
    list.push(issue);
    grouped.set(account, list);
  }
  return grouped;
}

/** "3 ads and 1 ad set" — reads better than a raw count of mixed objects. */
export function describeCounts(issues: BlockingIssue[]): string {
  const counts = new Map<BlockingIssue['edge'], number>();
  for (const issue of issues) counts.set(issue.edge, (counts.get(issue.edge) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([edge, n]) => `${n} ${EDGE_LABEL[edge]}${n === 1 ? '' : 's'}`)
    .join(' and ');
}

/** The notification title. Kept short because it also lands on a phone lock screen. */
export function alertTitle(issues: BlockingIssue[]): string {
  if (!issues.length) return '';
  const worst = issues[0];
  const first = `${EDGE_LABEL[worst.edge]} "${truncate(worst.name, 34)}"`;
  return issues.length === 1
    ? `⚠️ Meta blocked ${first}`
    : `⚠️ Meta blocked ${issues.length} of your ads (${first})`;
}

/** The notification body: the first problem in full, then the rest as a count. */
export function alertBody(issues: BlockingIssue[]): string {
  if (!issues.length) return '';
  const worst = issues[0];
  const head = `${worst.summary}${worst.message ? ` — ${truncate(worst.message, 160)}` : ''} (code ${worst.code}).`;
  const rest = issues.slice(1);
  if (!rest.length) return `${head} Fix it in Ads Manager to resume delivery.`;
  return `${head} ${describeCounts(rest)} more affected: ${rest
    .slice(0, 2)
    .map((i) => `${EDGE_LABEL[i.edge]} "${truncate(i.name, 24)}"`)
    .join(', ')}${rest.length > 2 ? ` and ${rest.length - 2} more` : ''}.`;
}

/** The deep link into the dashboard, so the alert is actionable. */
export function alertUrl(): string {
  return '/dashboard/ads';
}

/** Notification type; also the category the client's preferences are keyed on. */
export const ALERT_TYPE = 'campaign_failure';

/**
 * How long to stay quiet about the same problem.
 *
 * Twelve hours: long enough that a persisting problem does not page anyone six times
 * a day, short enough that a problem left over the weekend is raised again on Monday
 * morning instead of being assumed fixed.
 */
export const ALERT_DEDUPE_HOURS = 12;

/** Stable signature of a set of issues, used to decide whether anything changed. */
export function issueSignature(issues: BlockingIssue[]): string {
  return issues
    .map((i) => i.key)
    .sort()
    .join('|');
}

function truncate(value: string, max: number): string {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}
