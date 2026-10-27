import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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
        
        let logoUrl = url.searchParams.get('logoUrl') || '';
        let companyName = url.searchParams.get('companyName') || 'Apex Luxury Living';
        let projectTitle = url.searchParams.get('projectTitle') || 'The Grand Crest Luxury Residences';
        let projectPrice = url.searchParams.get('projectPrice') || '₹1.85 Cr (Special Launch Offer)';
        let location = url.searchParams.get('location') || 'Golf Course Extension, Prime Metro Corridor';
        let phone = url.searchParams.get('phone') || '+91 98886 26786';
        let heroImage = url.searchParams.get('heroImage') || '';

        if (req.method === 'POST') {
            try {
                const body = await req.json();
                if (body.logoUrl) logoUrl = body.logoUrl;
                if (body.companyName) companyName = body.companyName;
                if (body.projectTitle) projectTitle = body.projectTitle;
                if (body.projectPrice) projectPrice = body.projectPrice;
                if (body.location) location = body.location;
                if (body.phone) phone = body.phone;
                if (body.heroImage) heroImage = body.heroImage;
            } catch {}
        }

        const templatePath = path.join(process.cwd(), 'Generic_Luxury_Multipage_Website.html');
        let html = '';

        if (fs.existsSync(templatePath)) {
            html = fs.readFileSync(templatePath, 'utf-8');
        } else {
            return new Response('Website template not found', { status: 404 });
        }

        const cleanPhone = phone.replace(/\D/g, '') || '919888626786';
        const defaultHero = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1400&q=80';
        const finalHero = heroImage && heroImage.trim() ? heroImage : defaultHero;

        // Logo HTML markup
        let logoHtml = '';
        if (logoUrl && logoUrl.trim()) {
            logoHtml = `<img src="${logoUrl}" alt="${companyName}" class="h-10 w-auto max-w-[170px] object-contain rounded-lg" onerror="this.style.display='none'" />`;
        } else {
            const firstLetter = (companyName || 'N').trim().charAt(0).toUpperCase();
            logoHtml = `<div class="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-lg shadow-md shrink-0">${firstLetter}</div>`;
        }

        // Clean company slug for email placeholder
        const companySlug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Replace all placeholders
        html = html.replace(/{{PROJECT_TITLE}}/g, projectTitle);
        html = html.replace(/{{COMPANY_NAME}}/g, companyName);
        html = html.replace(/{{COMPANY_NAME_SLUG}}/g, companySlug);
        html = html.replace(/{{PROJECT_PRICE}}/g, projectPrice);
        html = html.replace(/{{LOCATION}}/g, location);
        html = html.replace(/{{PHONE}}/g, phone);
        html = html.replace(/{{CLEAN_PHONE}}/g, cleanPhone);
        html = html.replace(/{{HERO_IMAGE}}/g, finalHero);
        html = html.replace(/{{LOGO_HTML}}/g, logoHtml);

        return new Response(html, {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0'
            }
        });

    } catch (err: any) {
        console.error('[Demo Website API] Error serving demo website:', err);
        return new Response(`Error rendering demo website: ${err.message}`, { status: 500 });
    }
}
