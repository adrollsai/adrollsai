/**
 * Universal Lead Scoring Engine for Nobogent
 * Calculates dynamic, industry-agnostic 0-100 lead scores based on engagement,
 * qualification question completion, hand-raises, and contact completeness.
 */

export interface LeadScoreBreakdown {
  appointment: number; // Max 40 pts
  expert_request: number; // Max 25 pts
  qualification: number; // Max 25 pts
  contact_info: number; // Max 10 pts
}

export interface LeadScoreResult {
  score: number; // 0 - 100
  tier: 'hot' | 'warm' | 'cold';
  label: string;
  color: string;
  badgeEmoji: string;
  breakdown: LeadScoreBreakdown;
  answeredQuestionsCount: number;
  totalQuestionsCount: number;
}

/**
 * Normalizes custom_fields from JSON string or object
 */
export function parseCustomFields(customFields: any): Record<string, any> {
  if (!customFields) return {};
  if (typeof customFields === 'object') return customFields;
  try {
    let parsed = customFields;
    while (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

/**
 * Calculates dynamic lead score across all businesses & industries
 */
export function calculateLeadScore(
  lead: any,
  qualifyingQuestions: string[] = []
): LeadScoreResult {
  if (!lead) {
    return {
      score: 0,
      tier: 'cold',
      label: 'Cold',
      color: 'slate',
      badgeEmoji: '❄️',
      breakdown: { appointment: 0, expert_request: 0, qualification: 0, contact_info: 0 },
      answeredQuestionsCount: 0,
      totalQuestionsCount: qualifyingQuestions.length
    };
  }

  const cf = parseCustomFields(lead.custom_fields);
  let appointmentScore = 0;
  let expertScore = 0;
  let qualificationScore = 0;
  let contactScore = 0;

  // 1. Appointment Booked (Highest Intent Signal: up to 40 points)
  const hasBookedTime = !!lead.booked_time || !!cf.booked_time || !!cf.appointment_time || !!cf.meeting_time;
  const isAppointmentStage = [
    'appointment booked',
    'visit planned',
    'visit done',
    'revisit done',
    'deal/token',
    'negotiation'
  ].includes((lead.pipeline_stage || '').toLowerCase().trim());

  if (hasBookedTime || isAppointmentStage) {
    appointmentScore = 40;
  } else if ((lead.pipeline_stage || '').toLowerCase().includes('requirement')) {
    appointmentScore = 15;
  }

  // 2. Connect with Expert / Hand-Raise / Inbound Call (Up to 25 points)
  const hasExpertClicked = cf.connect_expert_clicked || cf.hand_raise || cf.requested_callback || cf.trigger_call;
  const isHighIntentSource = (lead.source || '').toLowerCase().includes('inbound') || (lead.source || '').toLowerCase().includes('whatsapp');
  if (hasExpertClicked) {
    expertScore = 25;
  } else if (isHighIntentSource) {
    expertScore = 15;
  } else if (cf.meta_ad_origin) {
    expertScore = 10;
  }

  // 3. Qualification Questions Completion (Up to 25 points proportional)
  const totalQuestions = qualifyingQuestions && qualifyingQuestions.length > 0 ? qualifyingQuestions.length : 0;
  let answeredCount = 0;

  if (totalQuestions > 0) {
    qualifyingQuestions.forEach(q => {
      const qClean = q.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
      const val = cf[q] || cf[qClean] || cf[`q_${qClean}`];
      if (val !== undefined && val !== null && String(val).trim().length > 0) {
        answeredCount++;
      }
    });

    const completionRatio = Math.min(answeredCount / totalQuestions, 1);
    qualificationScore = Math.round(completionRatio * 25);
  } else {
    // If business has 0 qualification questions configured, score basic qualifying fields (budget, property, requirement)
    let generalFieldsAnswered = 0;
    if (lead.budget || cf.budget) generalFieldsAnswered++;
    if (lead.property_id || cf.property_id || cf.interested_property) generalFieldsAnswered++;
    if (lead.notes || cf.requirement || cf.notes) generalFieldsAnswered++;
    qualificationScore = Math.min(generalFieldsAnswered * 8, 25);
    answeredCount = generalFieldsAnswered;
  }

  // 4. Contact Details & Identity (Up to 10 points)
  const hasRealName = lead.name && !lead.name.startsWith('+') && !/^\d+$/.test(lead.name.replace(/\D/g, '')) && lead.name !== 'Customer' && lead.name !== 'Prospect' && lead.name.length > 2;
  if (hasRealName) {
    contactScore += 7;
  }
  if (lead.email && lead.email.includes('@')) {
    contactScore += 3;
  }

  const rawScore = appointmentScore + expertScore + qualificationScore + contactScore;
  const score = Math.min(Math.max(rawScore, 0), 100);

  let tier: 'hot' | 'warm' | 'cold' = 'cold';
  let label = 'Cold';
  let color = 'slate';
  let badgeEmoji = '❄️';

  if (score >= 70) {
    tier = 'hot';
    label = 'Hot';
    color = 'rose';
    badgeEmoji = '🔥';
  } else if (score >= 40) {
    tier = 'warm';
    label = 'Warm';
    color = 'amber';
    badgeEmoji = '⚡';
  }

  return {
    score,
    tier,
    label,
    color,
    badgeEmoji,
    breakdown: {
      appointment: appointmentScore,
      expert_request: expertScore,
      qualification: qualificationScore,
      contact_info: contactScore
    },
    answeredQuestionsCount: answeredCount,
    totalQuestionsCount: totalQuestions
  };
}

/**
 * Updates the calculated lead score in database for a lead
 */
export async function updateLeadScoreInDB(
  supabaseAdmin: any,
  leadId: string,
  qualifyingQuestions?: string[]
): Promise<LeadScoreResult | null> {
  if (!leadId) return null;

  try {
    // 1. Fetch lead
    const { data: lead } = await supabaseAdmin
      .from('leads')
      .select('id, user_id, name, phone, email, budget, booked_time, pipeline_stage, source, property_id, custom_fields, notes')
      .eq('id', leadId)
      .single();

    if (!lead) return null;

    // 2. Fetch owner's qualifying questions if not passed
    let questions = qualifyingQuestions;
    if (!questions && lead.user_id) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('qualifying_questions')
        .eq('id', lead.user_id)
        .single();
      questions = profile?.qualifying_questions || [];
    }

    // 3. Compute score
    const result = calculateLeadScore(lead, questions || []);

    // 4. Update custom_fields with score metadata
    const cf = parseCustomFields(lead.custom_fields);
    cf.lead_score = result.score;
    cf.lead_tier = result.tier;
    cf.score_breakdown = result.breakdown;
    cf.score_updated_at = new Date().toISOString();

    await supabaseAdmin
      .from('leads')
      .update({
        custom_fields: cf
      })
      .eq('id', leadId);

    return result;
  } catch (err) {
    console.error(`[LeadScore] Error updating lead score for ${leadId}:`, err);
    return null;
  }
}
