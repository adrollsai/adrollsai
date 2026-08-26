/**
 * Universal Lead Scoring Engine for Nobogent
 * Calculates dynamic, industry-agnostic 0-100 lead scores based on engagement,
 * qualification question completion, hand-raises, and contact completeness.
 */

export interface LeadScoreBreakdown {
  questions_answered: number; // Max 40 pts
  appointment_booked: number; // Max 30 pts
  expert_clicked: number; // Max 15 pts
  view_products_clicked: number; // Max 15 pts
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
 * Deterministic Real Estate Lead Scoring Engine (100% Zero-AI)
 * Calculated strictly based on:
 * 1. How many qualification questions they've answered (Max 40 pts)
 * 2. Whether they have booked an appointment till now (Max 30 pts)
 * 3. Whether they've clicked on "Talk to an expert" (Max 15 pts)
 * 4. Whether they've clicked on "View products / properties" (Max 15 pts)
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
      breakdown: { questions_answered: 0, appointment_booked: 0, expert_clicked: 0, view_products_clicked: 0 },
      answeredQuestionsCount: 0,
      totalQuestionsCount: qualifyingQuestions.length || 3
    };
  }

  const cf = parseCustomFields(lead.custom_fields);
  
  // Default 3 standard questions for Real Estate if none configured
  const rawQuestions = (qualifyingQuestions && qualifyingQuestions.length > 0)
    ? qualifyingQuestions
    : ['property_type', 'budget', 'timeline'];
  
  const effectiveQuestions: { key: string; text: string }[] = [];
  rawQuestions.forEach((item: any, idx: number) => {
    if (typeof item === 'string') {
      const qClean = item.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
      const defaultKey = idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`;
      effectiveQuestions.push({ key: defaultKey, text: item });
      if (!effectiveQuestions.some(e => e.key === qClean)) {
        effectiveQuestions.push({ key: qClean, text: item });
      }
    } else if (typeof item === 'object' && item !== null) {
      const qText = item.question || item.text || `Question ${idx + 1}`;
      const defaultKey = item.field_name || (idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`);
      effectiveQuestions.push({ key: defaultKey, text: qText });
    }
  });

  const totalQuestions = rawQuestions.length || 3;
  let answeredCount = 0;

  // Check how many questions from rawQuestions have answers in cf or lead
  rawQuestions.forEach((item: any, idx: number) => {
    const defaultKey = typeof item === 'object' && item?.field_name 
      ? item.field_name 
      : (idx === 0 ? 'property_type' : idx === 1 ? 'budget' : idx === 2 ? 'timeline' : `custom_q_${idx}`);
    
    const itemText = typeof item === 'string' ? item : (item?.question || item?.text || '');
    const qClean = itemText.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);

    const val = cf[defaultKey] || cf[qClean] || cf[`q_${qClean}`] || 
                (qClean.includes('property') || defaultKey.includes('property') ? (cf.property_type || cf.interested_property || lead.property_id) : undefined) ||
                (qClean.includes('budget') || defaultKey.includes('budget') ? (cf.budget || lead.budget) : undefined) ||
                (qClean.includes('timeline') || defaultKey.includes('timeline') ? (cf.timeline || lead.timeline) : undefined);

    if (val !== undefined && val !== null && String(val).trim().length > 0) {
      answeredCount++;
    }
  });

  // Full 40 points awarded upon answering all questions, or if marked completed
  const isAllAnswered = totalQuestions > 0 && answeredCount >= totalQuestions;
  const isMarkedCompleted = !!(cf.qualification_completed || cf.is_qualified);

  const questionScore = (isAllAnswered || isMarkedCompleted)
    ? 40 
    : (totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 40) : 0);

  // 2. Appointment Booked (30 points)
  const hasBookedTime = !!lead.booked_time || !!cf.booked_time || !!cf.appointment_time || !!cf.meeting_time;
  const isAppointmentStage = [
    'appointment booked',
    'visit planned',
    'visit done',
    'revisit done',
    'deal/token',
    'negotiation'
  ].includes((lead.pipeline_stage || '').toLowerCase().trim());

  const appointmentScore = (hasBookedTime || isAppointmentStage) ? 30 : 0;

  // 3. Talk to an expert clicked (15 points)
  const hasExpertClicked = !!(cf.connect_expert_clicked || cf.talk_to_expert_clicked || cf.hand_raise || cf.requested_callback);
  const expertScore = hasExpertClicked ? 15 : 0;

  // 4. View products / properties clicked (15 points)
  const hasViewProductsClicked = !!(cf.view_properties_clicked || cf.view_products_clicked || cf.catalog_viewed || cf.website_visited);
  const viewProductsScore = hasViewProductsClicked ? 15 : 0;

  // Total Score (0 - 100)
  const rawScore = questionScore + appointmentScore + expertScore + viewProductsScore;
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
      questions_answered: questionScore,
      appointment_booked: appointmentScore,
      expert_clicked: expertScore,
      view_products_clicked: viewProductsScore
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
