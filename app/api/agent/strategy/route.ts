import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { product, quantity, instructions, previousAngles, creativeCategory } = await req.json();

    if (!product) {
        return NextResponse.json({ success: false, error: "Product data is missing" }, { status: 400 });
    }

    let targetCategory = creativeCategory || 'premium';
    let categoryDirective = "";
    
    if (targetCategory.toLowerCase().includes('premium')) {
        categoryDirective = "Style Target is PREMIUM: Focus on luxury, high-end commercial style showcasing the product/property, using premium warm sunset lighting, interior glow, modern clean layout, luxury textures, and elite aesthetic.";
    } else if (targetCategory.toLowerCase().includes('edm')) {
        categoryDirective = "Style Target is EDM (Emotion & Feeling): Focus on abstract lifestyle graphics and visual environments that evoke a feeling or state of mind (e.g. relaxing in pool, cozy cabin, starry sky, beautiful natural views) rather than showing the product directly. Emphasize visual hooklines and feeling.";
    } else if (targetCategory.toLowerCase().includes('high')) {
        categoryDirective = "Style Target is HIGH CONVERTING (Raw & Organic): Focus on unpolished, low-effort smartphone photography look. Suggest raw product/land close-ups or casual snapshots with a simple caption/text banner directly overlaying the image displaying bare minimum info (e.g. Location, Price, Configuration).";
    }

    const hasNegativeConstraint = instructions && /do not|don't|no |avoid|never|without|skip|not show|misrepresent|no picture|no photo|do not have/i.test(instructions);

    let negativeDirective = "";
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
      Generate ${quantity || 5} unique high-converting visual design style and aesthetic variations for this product/service ad:
      
      PRODUCT: ${product.title || 'Unknown Product'}
      DESCRIPTION: ${product.description || 'No description provided'}
      USER INSTRUCTIONS: ${instructions || 'None'}
      PREVIOUS VARIATIONS (AVOID THESE): ${previousAngles || 'None'}

      ${negativeDirective}
      ${categoryDirective}
      
      Provide distinct variations in the lighting, mood, color palette, setting, and layouts adhering strictly to the Category target and User Instructions above.
      
      For each variation, provide:
      1. Title (The name of the visual style variation, e.g. "Minimalist Typographic Luxury", "Location Spotlight Banner", etc.)
      2. Brief (The visual style description, lighting strategy, and colors)
      3. Visual Concept (A highly detailed description of the stylistic elements, visual layout, and background setting for the image generation model)
      
      FORMAT: Return ONLY a JSON array of objects with keys: title, brief, visual_concept. No markdown.
    `;

    const { text } = await generateText({
      model: google('gemini-3-flash-preview'),
      prompt,
    });

    try {
      const jsonStr = text.includes('```json') ? text.split('```json')[1].split('```')[0] : text;
      const angles = JSON.parse(jsonStr);
      return NextResponse.json({ success: true, angles });
    } catch (e) {
      return NextResponse.json({ success: false, error: "Failed to parse AI response" }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
