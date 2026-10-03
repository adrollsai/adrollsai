import { NextResponse } from 'next/server'
import { getAuditReport, getCampaignBySlug } from '@/utils/gbp-audit-storage'

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params
    if (!id) {
      return NextResponse.json({ error: 'Audit ID or token is required' }, { status: 400 })
    }

    const report = await getAuditReport(id)
    if (!report) {
      return NextResponse.json({ error: 'Audit report not found' }, { status: 404 })
    }

    // Also fetch associated campaign for white-label branding
    let campaign = null
    if (report.campaign_slug) {
      campaign = await getCampaignBySlug(report.campaign_slug)
    }

    return NextResponse.json({
      report,
      campaign
    })
  } catch (err: any) {
    console.error('[GBP Audit API] Error fetching audit report:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
