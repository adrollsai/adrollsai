import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export const maxDuration = 60;

function extractCleanBusinessInfo(info: any): string {
  if (!info) return '';
  if (typeof info === 'object') {
    return info._raw_text || info.bio || info.description || JSON.stringify(info);
  }
  if (typeof info === 'string') {
    const trimmed = info.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed._raw_text || parsed.bio || parsed.description || trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return String(info);
}

export async function POST(req: Request) {
  try {
    const { 
      product, 
      quantity, 
      instructions, 
      previousAngles, 
      creativeCategory, 
      businessInfo, 
      businessName, 
      missionStatement 
    } = await req.json();

    if (!product && (!instructions || !instructions.trim())) {
        return NextResponse.json({ 
          success: false, 
          error: "Please select a product or enter custom instructions for your campaign" 
        }, { status: 400 });
    }

    const cleanBusinessInfo = extractCleanBusinessInfo(businessInfo);
    const cleanMission = extractCleanBusinessInfo(missionStatement);

    let targetCategory = creativeCategory || 'premium';
    let categoryDirective = "";
    
    if (targetCategory.toLowerCase().includes('premium')) {
        categoryDirective = "Style Target is PREMIUM: Focus on luxury, high-end commercial advertising aesthetics tailored to the business domain. Crisp commercial lighting, sleek typography, elegant color palette, high-grade textures, and elite brand prestige.";
    } else if (targetCategory.toLowerCase().includes('edm')) {
        categoryDirective = "Style Target is EDM (Emotion & Storytelling): Focus on aspirational visual environments, lifestyle freedom, and customer relief or empowerment delivered by the product or service. Emphasize emotional hooklines and tangible transformation.";
    } else if (targetCategory.toLowerCase().includes('high')) {
        categoryDirective = "Style Target is HIGH CONVERTING (Direct-Response & Organic): Focus on scroll-stopping, high-urgency commercial ad layouts. Bold value propositions, high-contrast badge overlays, side-by-side comparisons, or candid smartphone snapshots that feel authentic and native in social feeds.";
    }

    const hasNegativeConstraint = instructions && /do not|don't|no |avoid|never|without|skip|not show|misrepresent|no picture|no photo|do not have/i.test(instructions);

    let negativeDirective = "";
    if (hasNegativeConstraint) {
      negativeDirective = `
      CRITICAL USER NEGATIVE DIRECTIVE (MANDATORY HIGHEST PRIORITY OVERRIDE):
      The user explicitly provided these custom instructions: "${instructions}"
      You MUST STRICTLY ADHERE to any negative constraint specified by the user (such as avoiding specific imagery, not showing certain items, avoiding misrepresentation, skipping logos/people/buildings, etc.).
      
      STRICT MANDATORY RULES FOR NEGATIVE CONSTRAINTS:
      - ABSOLUTELY NEVER describe or include any element the user asked to avoid in ANY visual_concept, title, or brief.
      - Instead, create creative strategies focused on bold benefit-driven copywriting, authentic product/service value propositions, and clean visual storytelling that respects the user's boundaries 100%.
      `;
    }

    const isBrandOnly = !product;

    const subjectContext = isBrandOnly ? `
      CAMPAIGN TYPE: General Brand & Custom Instruction Campaign (No specific product selected)
      BUSINESS NAME: ${businessName || 'Our Business'}
      BUSINESS INFO & SERVICES: ${cleanBusinessInfo || cleanMission || 'Leading provider committed to excellence'}
      CUSTOM USER INSTRUCTIONS: ${instructions || 'General high-converting brand promotion'}
      NOTE: No specific product is selected. Generate distinct visual angles, hooks, and design concepts focused on promoting the business brand, core services, trust, credibility, and value proposition strictly adhering to the custom instructions and business information above.
    ` : `
      CAMPAIGN TYPE: Specific Product Promotion
      PRODUCT: ${product.title || 'Unknown Product'}
      DESCRIPTION: ${product.description || 'No description provided'}
      USER INSTRUCTIONS: ${instructions || 'None'}
    `;

    const prompt = `
      You are an elite Creative Director and Direct-Response Advertising Strategist with 20+ years of experience generating multi-million-dollar ad campaigns across all industries (SaaS, AI software, e-commerce, local services, healthcare, automotive, food, real estate, and B2B agencies).
      
      Generate ${quantity || 5} unique HIGH-CONVERTING visual creative angles and design style variations for this ad campaign:
      
      ${subjectContext}
      PREVIOUS VARIATIONS (AVOID REPEATING THESE): ${previousAngles || 'None'}

      ${negativeDirective}
      ${categoryDirective}
      
      CRITICAL INDUSTRY-AGNOSTIC GUIDELINES:
      1. ANALYZE WHAT THIS BUSINESS ACTUALLY DOES & SELLS:
         - Read the business info, services, and product details carefully.
         - If the business is an AI or SaaS software platform (e.g. Nobogent: AI Voice Calling, automated WhatsApp, CRM, ad campaign automation, video/lead generation for companies):
           * The angles MUST focus on software value propositions (e.g., stopping lead leaks, replacing expensive agencies and freelancers, automated outbound calling in seconds, 24/7 WhatsApp AI qualification, scaling revenue without hiring massive teams).
           * The visual concepts MUST depict sleek software interfaces, glowing AI voice waveforms, frosted glassmorphic KPI dashboard cards, high-converting direct-response comparison grids, or a smiling modern entrepreneur/marketer with genuine relief in a bright contemporary tech workspace.
           * Strictly NEVER depict physical real estate properties, villas, floorplans, or houses unless the selected product is literally a physical property being sold.
         - If the business is an E-Commerce or Physical Product brand: Showcase the product in pristine commercial studio or aspirational lifestyle use.
         - If the business is a Clinic / Healthcare / Local Service / Agency: Showcase trusted professionals, genuine client transformations, or clean service proof.
         - If the business is Real Estate: Showcase property architecture, interior finishes, and prime location ONLY if physical property is what is actually being sold.

      2. HIGH-CONVERTING MARKETING FRAMEWORKS FOR THE ANGLES:
         Ensure the generated angles represent diverse, battle-tested direct-response frameworks:
         - ANGLE TYPE A: Pain Point Agitation / Friction Callout (calling out the expensive, slow, or chaotic status quo).
         - ANGLE TYPE B: Signature Feature / Technology Spotlight (highlighting a killer feature in action, like 24/7 AI voice dialing or 1-click lead capture).
         - ANGLE TYPE C: Before vs After / Stark Transformation (chaos & manual burnout vs automated ease & explosive growth).
         - ANGLE TYPE D: ROI & Metrics Proof (concrete results: 10x speed, 0 wasted ad spend, higher conversion rates).
         - ANGLE TYPE E: Speed & Automation / Effortless Scaling (executing in minutes what used to take weeks).
         - ANGLE TYPE F: Authority, Trust & Social Proof (positioning the brand as the undisputed leader in its category).

      3. OUTPUT SPECIFICATIONS:
         For each angle, provide:
         - title: Punchy, high-impact angle name (e.g., "The Agency Replacement Engine", "24/7 AI Voice Dispatcher", "The Chaos-to-Growth Pipeline", "Instant High-Converting ROI Banner")
         - brief: Clear summary of the marketing hook, the core customer desire or pain point addressed, and the lighting/color mood.
         - visual_concept: An ultra-detailed, photorealistic description of the visual layout, hero element, focal subject, background setting, badge pills, and typography placement for an AI image generation model.

      FORMAT: Return ONLY a JSON array of objects with keys: title, brief, visual_concept. No markdown, no conversational text.
    `;

    const { text } = await generateText({
      model: google('gemini-3-flash-preview'),
      prompt,
    });

    try {
      let jsonStr = text.trim();
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
      }
      const angles = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, angles });
    } catch (e) {
      return NextResponse.json({ success: false, error: "Failed to parse AI response" }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
