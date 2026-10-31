import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    return handleWebsiteServe(req);
}

export async function POST(req: Request) {
    return handleWebsiteServe(req);
}

async function handleWebsiteServe(req: Request) {
    try {
        const url = new URL(req.url);
        const redirectUrl = new URL('/real-estate-template/index.html', url.origin);
        
        url.searchParams.forEach((val, key) => {
            redirectUrl.searchParams.set(key, val);
        });

        if (req.method === 'POST') {
            try {
                const body = await req.json();
                Object.entries(body).forEach(([k, v]) => {
                    if (v && typeof v === 'string') redirectUrl.searchParams.set(k, v);
                });
            } catch {}
        }

        return NextResponse.redirect(redirectUrl.toString(), 302);
    } catch (e: any) {
        return new Response('Website error: ' + e.message, { status: 500 });
    }
}
