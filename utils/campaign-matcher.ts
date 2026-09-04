/**
 * Robust Campaign & Lead Attribution Matcher
 * Ensures Group-Distribution and Campaign-Assignment rules match
 * 100% reliably based on Campaign Name, Campaign ID, Form Name, Form ID, and Ad Name.
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
    .replace(/[^\w\s-]/g, '') // remove special characters like quotes, colons
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

/**
 * Checks whether a given lead matches a campaign or form rule entry
 * @param ruleCampaign The campaign or form string/ID configured in the rule (e.g. from the dropdown)
 * @param lead The incoming lead metadata
 * @param userCampaignsMap Optional mapping of campaign ID -> campaign name or campaign name -> campaign ID
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

  // 1. Direct ID Matches
  // Campaign ID Match
  if (leadCampId && !isExplicitForm && (leadCampId === ruleRaw || leadCampId === rawTrimmed || ruleNorm === leadCampId)) {
    return true;
  }
  // Form ID Match
  if (leadFormId && !isExplicitCamp && (leadFormId === ruleRaw || leadFormId === rawTrimmed || ruleNorm === leadFormId)) {
    return true;
  }

  // 2. Lookup through userCampaignsMap (if Campaign ID or Name was selected)
  if (userCampaignsMap && !isExplicitForm) {
    if (leadCampId && userCampaignsMap.idToName?.[leadCampId]) {
      const dbCampNameNorm = normalizeCampaignString(userCampaignsMap.idToName[leadCampId]);
      if (dbCampNameNorm === ruleNorm || dbCampNameNorm.includes(ruleNorm) || ruleNorm.includes(dbCampNameNorm)) {
        return true;
      }
    }
    if (userCampaignsMap.nameToId?.[ruleRaw] && leadCampId === userCampaignsMap.nameToId[ruleRaw]) {
      return true;
    }
    if (userCampaignsMap.nameToId?.[rawTrimmed] && leadCampId === userCampaignsMap.nameToId[rawTrimmed]) {
      return true;
    }
  }

  // 3. Form Name Exact / Normalized / Substring Match (unless explicitly campaign-only)
  if (!isExplicitCamp && leadFormNameNorm && ruleNorm) {
    if (leadFormNameNorm === ruleNorm) return true;
    if (leadFormNameNorm.includes(ruleNorm) || ruleNorm.includes(leadFormNameNorm)) return true;
  }

  // 4. Campaign Name Exact / Normalized / Substring Match (unless explicitly form-only)
  if (!isExplicitForm && leadCampNameNorm && ruleNorm) {
    if (leadCampNameNorm === ruleNorm) return true;
    if (leadCampNameNorm.includes(ruleNorm) || ruleNorm.includes(leadCampNameNorm)) return true;
  }

  // 5. Ad Campaign String Match (e.g., "Campaign Name / Ad Name")
  if (!isExplicitForm && leadAdCampStrNorm && ruleNorm) {
    if (leadAdCampStrNorm.includes(ruleNorm) || ruleNorm.includes(leadAdCampStrNorm)) return true;
  }

  // 6. Ad Name Match
  if (leadAdNameNorm && ruleNorm) {
    if (leadAdNameNorm.includes(ruleNorm) || ruleNorm.includes(leadAdNameNorm)) return true;
  }

  // 7. Sub-segment matching (for compound campaign/form titles like "Anmol Avenue - 12-03-2026")
  const segments = ruleNorm.split(/[-|/]/).map(seg => seg.trim()).filter(seg => seg.length >= 3 && !/^\d+$/.test(seg));
  for (const seg of segments) {
    if (!isExplicitCamp && leadFormNameNorm && leadFormNameNorm.includes(seg)) return true;
    if (!isExplicitForm && leadCampNameNorm && leadCampNameNorm.includes(seg)) return true;
    if (!isExplicitForm && leadAdCampStrNorm && leadAdCampStrNorm.includes(seg)) return true;
    if (leadAdNameNorm && leadAdNameNorm.includes(seg)) return true;
  }

  return false;
}
