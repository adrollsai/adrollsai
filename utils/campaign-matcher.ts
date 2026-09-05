/**
 * Deterministic Campaign & Lead Attribution Matcher
 * Uses exact Campaign IDs, Form IDs, and clean full-string equality.
 * No loose regex or arbitrary substring matching that causes false positives.
 */

export function normalizeCampaignString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/^\[(form|campaign|ad)\]\s*/i, '') // remove prefix like [Form] or [Campaign]
    .replace(/^(form|campaign|ad):\s*/i, '') // remove prefix like Form: or Campaign:
    .replace(/[\u2010-\u2015\u2212]/g, '-') // Normalize various unicode dashes
    .toLowerCase()
    .replace(/\bhaymten\b/g, 'hampton')
    .replace(/\bhamyten\b/g, 'hampton')
    .replace(/[^\w\s-]/g, '') // remove special characters like quotes, punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchLeadContext {
  campaignId?: string | null;
  campaignName?: string | null;
  adName?: string | null;
  formName?: string | null;
  formId?: string | null;
  adCampaignString?: string | null;
}

const STOP_WORDS = new Set([
  'copy', 'copies', 'new', 'ad', 'ads', 'campaign', 'campaigns', 'form', 'forms',
  'lead', 'leads', 'page', 'pages', 'test', 'wp', 'office', 'price', 'cost', 'budget',
  'website', 'landing', 'direct'
]);

/**
 * Checks whether a given lead matches a campaign or form rule entry.
 * Prioritizes:
 * 1. Exact Campaign ID or Form ID match (100% deterministic)
 * 2. ID lookup through userCampaignsMap
 * 3. Exact full-name match (case-insensitive & whitespace trimmed)
 * 4. Controlled whole-token prefix match (e.g. "Ananta Aspire" matching "Ananta Aspire 5 September 2026")
 * 
 * Never uses fuzzy token splitting or regex searching that could match "copy" against "Price-copy".
 */
export function matchesCampaignRule(
  ruleCampaign: string,
  lead: MatchLeadContext,
  userCampaignsMap?: { idToName?: Record<string, string>; nameToId?: Record<string, string> }
): boolean {
  if (!ruleCampaign) return false;

  const rawTrimmed = ruleCampaign.trim();
  if (!rawTrimmed) return false;

  // Check if rule is explicitly tagged
  const isExplicitForm = /^\[form\]/i.test(rawTrimmed) || /^form:/i.test(rawTrimmed);
  const isExplicitCamp = /^\[campaign\]/i.test(rawTrimmed) || /^campaign:/i.test(rawTrimmed);

  // Clean the rule string of tags
  const cleanRule = rawTrimmed
    .replace(/^\[(form|campaign|ad)\]\s*/i, '')
    .replace(/^(form|campaign|ad):\s*/i, '')
    .trim();

  const ruleNorm = normalizeCampaignString(cleanRule);
  const ruleRaw = cleanRule.trim();
  if (!ruleNorm && !ruleRaw) return false;

  const leadCampId = String(lead.campaignId || '').trim();
  const leadFormId = String(lead.formId || '').trim();
  const leadCampNameNorm = normalizeCampaignString(lead.campaignName);
  const leadFormNameNorm = normalizeCampaignString(lead.formName);
  const leadAdNameNorm = normalizeCampaignString(lead.adName);
  const leadAdCampStrNorm = normalizeCampaignString(lead.adCampaignString);

  // 1. EXACT ID MATCHES (Deterministic)
  // Campaign ID Match
  if (leadCampId && !isExplicitForm) {
    if (leadCampId === ruleRaw || leadCampId === rawTrimmed || ruleNorm === leadCampId) {
      return true;
    }
  }

  // Form ID Match
  if (leadFormId && !isExplicitCamp) {
    if (leadFormId === ruleRaw || leadFormId === rawTrimmed || ruleNorm === leadFormId) {
      return true;
    }
  }

  // 2. Lookup through userCampaignsMap (ID <-> Name)
  if (userCampaignsMap && !isExplicitForm) {
    if (leadCampId && userCampaignsMap.idToName?.[leadCampId]) {
      const dbCampNameNorm = normalizeCampaignString(userCampaignsMap.idToName[leadCampId]);
      if (dbCampNameNorm && dbCampNameNorm === ruleNorm) return true;
    }
    if (userCampaignsMap.nameToId?.[ruleRaw] && leadCampId === userCampaignsMap.nameToId[ruleRaw]) {
      return true;
    }
    if (userCampaignsMap.nameToId?.[rawTrimmed] && leadCampId === userCampaignsMap.nameToId[rawTrimmed]) {
      return true;
    }
    if (userCampaignsMap.nameToId?.[cleanRule] && leadCampId === userCampaignsMap.nameToId[cleanRule]) {
      return true;
    }
  }

  // 3. EXACT FULL NAME MATCHES (Case-insensitive, normalized)
  // Form Name Exact Match
  if (!isExplicitCamp && leadFormNameNorm && ruleNorm) {
    if (leadFormNameNorm === ruleNorm) return true;
  }

  // Campaign Name Exact Match
  if (!isExplicitForm && leadCampNameNorm && ruleNorm) {
    if (leadCampNameNorm === ruleNorm) return true;
  }

  // Ad Campaign String Exact Match (e.g., "Campaign Name / Ad Name")
  if (!isExplicitForm && leadAdCampStrNorm && ruleNorm) {
    if (leadAdCampStrNorm === ruleNorm) return true;
  }

  // Ad Name Exact Match
  if (leadAdNameNorm && ruleNorm) {
    if (leadAdNameNorm === ruleNorm) return true;
  }

  // 4. CONTROLLED WORD-BOUNDARY PREFIX MATCH
  // Example: Rule "Ananta Aspire" cleanly matches "Ananta Aspire 5 September 2026" or "Ananta Aspire - 14 July"
  // Rejects stop words, noise words, or reverse prefix matches.
  if (ruleNorm.length >= 4 && !STOP_WORDS.has(ruleNorm)) {
    const isPrefixOf = (leadStr: string) => {
      if (!leadStr) return false;
      return leadStr.startsWith(ruleNorm + ' ') || 
             leadStr.startsWith(ruleNorm + '-') || 
             leadStr.startsWith(ruleNorm + ' -');
    };

    if (!isExplicitForm && leadCampNameNorm && isPrefixOf(leadCampNameNorm)) return true;
    if (!isExplicitCamp && leadFormNameNorm && isPrefixOf(leadFormNameNorm)) return true;
    if (!isExplicitForm && leadAdCampStrNorm && isPrefixOf(leadAdCampStrNorm)) return true;
  }

  return false;
}
