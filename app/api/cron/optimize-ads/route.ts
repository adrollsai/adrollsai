import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    // Cron job permanently disabled from modifying live Meta ad/campaign statuses.
    return NextResponse.json({ 
        message: "Automated ad-pause optimization is permanently disabled.",
        status: "disabled"
    });
}