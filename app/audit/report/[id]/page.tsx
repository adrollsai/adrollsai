import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getAuditReport, getCampaignBySlug } from '@/utils/gbp-audit-storage'
import AuditReportClient from '@/components/gbp/AuditReportClient'

export const dynamic = 'force-dynamic'

interface ReportPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata(props: ReportPageProps): Promise<Metadata> {
  const { id } = await props.params
  const report = await getAuditReport(id)

  if (!report) {
    return {
      title: 'Google Business Profile Audit Not Found | Nobogent',
      description: 'Audit report could not be found or has expired.'
    }
  }

  return {
    title: `${report.business_name} - Google Business Profile Audit & Local Rank Report`,
    description: `Local SEO Audit Score: ${report.overall_score}/100. Diagnostic analysis, top 3 competitors, and 49-point geo-grid keyword heatmap for ${report.business_name}.`,
    openGraph: {
      title: `${report.business_name} - Google Business Profile Local SEO Audit`,
      description: `Audit Score: ${report.overall_score}/100. See your local 3-pack rank and geo-grid heatmap.`,
    }
  }
}

export default async function AuditReportPage(props: ReportPageProps) {
  const { id } = await props.params
  const report = await getAuditReport(id)

  if (!report) {
    notFound()
  }

  const campaign = report.campaign_slug ? await getCampaignBySlug(report.campaign_slug) : null

  return <AuditReportClient report={report} campaign={campaign} />
}
