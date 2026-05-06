import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { product, quantity, instructions, previousAngles } = await req.json();

    if (!product) {
        return NextResponse.json({ success: false, error: "Product data is missing" }, { status: 400 });
    }

    const prompt = `
      You are a world-class Direct Response Marketing Strategist. 
      Generate ${quantity || 5} unique high-converting ad angles/hooks for this product:
      
      PRODUCT: ${product.title || 'Unknown Product'}
      DESCRIPTION: ${product.description || 'No description provided'}
      USER INSTRUCTIONS: ${instructions || 'None'}
      PREVIOUS ANGLES (AVOID THESE): ${previousAngles || 'None'}

      FRAMEWORK: Use Alex Hormozi's Value Equation (Dream Outcome, Perceived Likelihood of Achievement, Time Delay, Effort & Sacrifice).
      
      For each angle, provide:
      1. Title (The Hook)
      2. Brief (Marketing strategy and 'why' it works)
      3. Visual Concept (What should the 'Raw/Organic' image look like?)
      
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
