import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

async function testStrategy() {
  const instructions = 'since we do not have the pictures of kothi, make the creatives so that we do not show a kothi that mis represents it, find another way to promote this';
  const product = { title: '1 Kanal Luxury Kothi in Sector 18 Chandigarh', description: 'Super luxury kothi in prime sector of Chandigarh' };
  
  const hasNegativeConstraint = instructions && /do not|don't|no |avoid|never|without|skip|not show|misrepresent|no picture|no photo|do not have/i.test(instructions);

  let negativeDirective = '';
  if (hasNegativeConstraint) {
    negativeDirective = `
    CRITICAL USER NEGATIVE DIRECTIVE (MANDATORY HIGHEST PRIORITY OVERRIDE):
    The user explicitly provided these custom instructions: "${instructions}"
    You MUST STRICTLY ADHERE to any negative constraint specified by the user (such as "do not show a kothi/house", "no building exterior", "avoid property photos", "do not misrepresent", "no photos of kothi", etc.).
    
    STRICT MANDATORY RULES FOR NEGATIVE CONSTRAINTS:
    - ABSOLUTELY NEVER describe or include exterior architectural photos of houses, kothis, villas, or buildings in ANY visual_concept, title, or brief.
    - Instead, create creative strategies focused on:
      1. Abstract luxury graphic design & minimalist typography.
      2. High-end lifestyle close-ups (e.g. golden keys, luxury interior textures, floorplans, location maps).
      3. Bold benefit-driven copywriting banners and prime location highlights.
    - Every single visual_concept MUST respect this negative restriction 100%. Do NOT generate shots of house/kothi exteriors under any circumstances.
    `;
  }

  const prompt = `
    You are an elite commercial graphic designer and visual ad director.
    Generate 3 unique high-converting visual design style and aesthetic variations for this product/service ad:
    
    PRODUCT: ${product.title}
    DESCRIPTION: ${product.description}
    USER INSTRUCTIONS: ${instructions}

    ${negativeDirective}
    
    Provide distinct variations in the lighting, mood, color palette, setting, and layouts adhering strictly to the User Instructions above.
    
    For each variation, provide:
    1. Title (The name of the visual style variation)
    2. Brief (The visual style description, lighting strategy, and colors)
    3. Visual Concept (A highly detailed description of the stylistic elements, visual layout, and background setting for the image generation model)
    
    FORMAT: Return ONLY a JSON array of objects with keys: title, brief, visual_concept. No markdown.
  `;

  const { text } = await generateText({
    model: google('gemini-3-flash-preview'),
    prompt,
  });

  console.log("=========================================");
  console.log("AI GENERATED STRATEGY CONCEPTS (POST-FIX):");
  console.log("=========================================");
  console.log(text);
}

testStrategy().catch(err => console.error("Error:", err));
