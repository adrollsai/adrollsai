/**
 * Robust Campaign & Lead Attribution Matcher
 * Ensures Group-Distribution and Campaign-Assignment rules match
 * 100% reliably based on Campaign Name, Campaign ID, and Ad Name.
 */

export function normalizeCampaignString(str: string | null | undefined): string {
  if (!str) return '';
  return str
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
  adCampaignString?: string | null;
}

/**
 * Checks whether a given lead matches a campaign rule entry
 * @param ruleCampaign The campaign string/ID configured in the rule (e.g. from the dropdown)
 * @param lead The incoming lead metadata
 * @param userCampaignsMap Optional mapping of campaign ID -> campaign name or campaign name -> campaign ID
 */
export function matchesCampaignRule(
  ruleCampaign: string,
  lead: MatchLeadContext,
  userCampaignsMap?: { idToName?: Record<string, string>; nameToId?: Record<string, string> }
): boolean {
  if (!ruleCampaign) return false;

  const ruleNorm = normalizeCampaignString(ruleCampaign);
  const ruleRaw = ruleCampaign.trim();
  if (!ruleNorm && !ruleRaw) return false;

  const leadCampId = String(lead.campaignId || '').trim();
  const leadCampNameNorm = normalizeCampaignString(lead.campaignName);
  const leadAdNameNorm = normalizeCampaignString(lead.adName);
  const leadAdCampStrNorm = normalizeCampaignString(lead.adCampaignString);
  const leadFormNameNorm = normalizeCampaignString(lead.formName);

  // 1. Direct Meta Campaign ID Match
  if (leadCampId && (leadCampId === ruleRaw || ruleNorm === leadCampId)) {
    return true;
  }

  // 2. Lookup through userCampaignsMap (if Campaign ID was selected or Name was selected)
  if (userCampaignsMap) {
    if (leadCampId && userCampaignsMap.idToName?.[leadCampId]) {
      const dbCampNameNorm = normalizeCampaignString(userCampaignsMap.idToName[leadCampId]);
      if (dbCampNameNorm === ruleNorm || dbCampNameNorm.includes(ruleNorm) || ruleNorm.includes(dbCampNameNorm)) {
        return true;
      }
    }
    if (userCampaignsMap.nameToId?.[ruleRaw] && leadCampId === userCampaignsMap.nameToId[ruleRaw]) {
      return true;
    }
  }

  // 3. Campaign Name Exact / Normalized Match
  if (leadCampNameNorm) {
    if (leadCampNameNorm === ruleNorm) return true;
    if (leadCampNameNorm.includes(ruleNorm) || ruleNorm.includes(leadCampNameNorm)) return true;
  }

  // 4. Ad Campaign String Match (e.g., "Campaign Name / Ad Name")
  if (leadAdCampStrNorm) {
    if (leadAdCampStrNorm.includes(ruleNorm) || ruleNorm.includes(leadAdCampStrNorm)) return true;
  }

  // 5. Ad Name Match
  if (leadAdNameNorm) {
    if (leadAdNameNorm.includes(ruleNorm) || ruleNorm.includes(leadAdNameNorm)) return true;
  }

  // 6. Sub-segment matching (for compound campaign titles like "Anmol Avenue - 12-03-2026")
  const segments = ruleNorm.split(/[-|/]/).map(seg => seg.trim()).filter(seg => seg.length >= 3 && !/^\d+$/.test(seg));
  for (const seg of segments) {
    if (leadCampNameNorm && leadCampNameNorm.includes(seg)) return true;
    if (leadAdCampStrNorm && leadAdCampStrNorm.includes(seg)) return true;
    if (leadAdNameNorm && leadAdNameNorm.includes(seg)) return true;
    if (leadFormNameNorm && leadFormNameNorm.includes(seg)) return true;
  }

  return false;
}
