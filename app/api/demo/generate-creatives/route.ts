import { NextResponse } from 'next/server';
import { generateDualDemoCreatives, CreativeInput } from '@/utils/demo-creative-engine';

export const maxDuration = 180;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const body: CreativeInput = await req.json();

        if (!body.projectTitle || !body.companyName) {
            return NextResponse.json({
                error: 'Company Name and Project Title are required.'
            }, { status: 400 });
        }

        console.log(`[Demo API] Generating 3:4 creatives for "${body.projectTitle}" (${body.companyName})...`);
        const result = await generateDualDemoCreatives(body);

        return NextResponse.json({
            success: true,
            creatives: result.creatives,
            video: result.video,
            adCopy: result.adCopy
        });
    } catch (error: any) {
        console.error('[Demo API] Creative generation failed:', error);
        return NextResponse.json({
            error: error.message || 'Failed to generate demo creatives'
        }, { status: 500 });
    }
}
