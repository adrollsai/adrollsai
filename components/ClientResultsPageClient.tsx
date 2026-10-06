'use client'

import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp,
  Users,
  Calendar,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Phone,
  Sparkles,
  MessageSquare,
  Building2,
  DollarSign,
  Clock,
  ChevronRight,
  Award,
  Zap,
  Target,
  BarChart3,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  UserCheck,
  Send,
  Loader2,
  Star,
  MapPin,
  Bot
} from 'lucide-react'
import Link from 'next/link'
import LandingNavbar from '@/components/LandingNavbar'

// Types
type CaseStudyCategory = 'all' | 'township' | 'omnichannel' | 'luxury' | 'global'

interface CaseStudy {
  id: string
  clientName: string
  category: CaseStudyCategory
  categoryLabel: string
  location: string
  projectType: string
  heroHeadline: string
  summary: string
  logoUrl?: string
  logoText?: string
  brandColor: string
  metrics: {
    totalLeads: string
    qualificationRate: string
    expertConnects: string
    siteVisits: string
    keyHighlightLabel: string
    keyHighlightValue: string
  }
  theChallenge: string
  theSolution: string
  verifiedHighlights: string[]
  adCampaign: string
  sampleLead: {
    buyerProfile: string
    budget: string
    timeline: string
    intent: string
    actionTaken: string
  }
}

export default function ClientResultsPageClient() {
  const [selectedCategory, setSelectedCategory] = useState<CaseStudyCategory>('all')
  const [activeTabId, setActiveTabId] = useState<string>('red-rose')
  
  // Interactive Calculator State
  const [calcBudget, setCalcBudget] = useState<number>(50000)
  const [calcAvgPrice, setCalcAvgPrice] = useState<number>(75) // in Lakhs
  
  // WhatsApp Bot Demo State
  const [botStep, setBotStep] = useState<number>(0)
  const [botResponses, setBotResponses] = useState<{ [key: string]: string }>({})
  const [botSimulating, setBotSimulating] = useState<boolean>(false)

  // Contact Form State
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formProject, setFormProject] = useState('')
  const [formBudget, setFormBudget] = useState('₹50,000 - ₹1,00,000')
  const [formTimeline, setFormTimeline] = useState('Immediately')
  const [formNotes, setFormNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState('')

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  // Verified Client Data
  const caseStudies: CaseStudy[] = [
    {
      id: 'red-rose',
      clientName: 'Red Rose City',
      category: 'township',
      categoryLabel: '21-Acre Plotted Township',
      location: 'Sector 9, Dera Bassi (Punjab / Tricity)',
      projectType: 'RERA-Approved Gated Township by Alpine Nest Homes',
      heroHeadline: '532 Inquiries, 56.0% AI Qualification Rate & 53 Direct "Connect With Expert" Conversions',
      summary: 'How an automated WhatsApp Conversational AI qualification bot filtered out casual window shoppers and handed off 53 high-intent, budget-qualified plot buyers straight to the township sales director.',
      logoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/c3893924-5a57-4da3-b4bc-7c70d8ee7c59/1788432741401-c3893924-5a57-4da3-b4bc-7c70d8ee7c59-1788432740101.jpg',
      brandColor: '#B22B31',
      metrics: {
        totalLeads: '532+',
        qualificationRate: '56.0%',
        expertConnects: '53 Clicks',
        siteVisits: '8 Booked',
        keyHighlightLabel: 'Budget Disclosures',
        keyHighlightValue: '317 Verified'
      },
      theChallenge: 'Red Rose City was getting hundreds of WhatsApp messages from Meta ads, but 70% were casual lookers or inactive numbers. Their two-person sales desk spent whole afternoons typing basic FAQs and missing serious weekend site visitors.',
      theSolution: 'Nobogent installed a Conversational WhatsApp AI Qualification Agent connected via Meta CAPI. The AI instantly greeted every inbound ad click within 15 seconds, verified plot size preferences (100–150 sq. yd.), gated for budget (₹50L–₹70L+), and offered a 1-click "Connect with Expert" button that routed warm leads to sales staff phones with instant push notifications.',
      verifiedHighlights: [
        '53 direct "Connect With Expert" button clicks by verified buyers',
        '298 Hot & Warm AI-qualified leads logged in CRM with verified budget and timeline',
        '56 buyers specifically flagged with "Immediate / Within 30 Days" purchase timeline',
        'Zero manual intervention needed for initial greeting, plot brochure dispatch, and questionnaire',
        'Over ₹35+ Crore in active buyer pipeline created in under 60 days'
      ],
      adCampaign: 'Red Rose City - Alpine Nest Homes (Sector 9 Dera Bassi Plots) / AI Ad Variations',
      sampleLead: {
        buyerProfile: 'Sunny (Local Business Owner, Tri-city)',
        budget: '₹60 Lakh - ₹70 Lakh (Verified)',
        timeline: 'Next Month (Immediate Buyer)',
        intent: '100–150 Sq. Yd. Possession Ready Corner Plot',
        actionTaken: 'Completed WhatsApp bot qualification and clicked "Connect With Expert" for direct site visit negotiation.'
      }
    },
    {
      id: 'bluesquare',
      clientName: 'Blue Square Infra',
      category: 'omnichannel',
      categoryLabel: 'Omnichannel Real Estate Leader',
      location: 'Jammu & Kashmir • Punjab • Chandigarh Tricity',
      projectType: 'Large-scale Residential & Commercial Consultancy (Bantalab House, etc.)',
      heroHeadline: '16,027 Inquiries Ingested & 990 In-Person Site Visits Executed with Omnichannel CRM Sync',
      summary: 'Consolidating Facebook Ads, 99Acres, WhatsApp Ads, MagicBricks, and IVR leads into a sub-60-second automated response engine to maximize on-ground site visit attendance.',
      logoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/logos/2f62a259-f23b-48ee-a920-c436f36eaa4b/1785305575571-2f62a259-f23b-48ee-a920-c436f36eaa4b-1785305574448.jpg',
      brandColor: '#003D6F',
      metrics: {
        totalLeads: '16,027+',
        qualificationRate: 'Omnichannel',
        expertConnects: 'Instant Sync',
        siteVisits: '990 Visits',
        keyHighlightLabel: 'Lead Velocity',
        keyHighlightValue: '< 60 Sec'
      },
      theChallenge: 'Blue Square Infra was pouring advertising budget across multiple portals (Meta, 99Acres, MagicBricks, IVR), but leads were sitting unattended in portal backends for 3 to 6 hours. High lead latency meant customers answered competitors by the time Blue Square reps called.',
      theSolution: 'Nobogent unified all 8 lead streams into one automated pipeline with instantaneous webhook ingestion, automated assignment, automated SMS/WhatsApp acknowledgments, and systematic pipeline staging (New Lead → Requirement Taken → Visit Planned → Visit Done).',
      verifiedHighlights: [
        '16,027 total leads processed seamlessly without a single dropped webhook',
        '990 verified in-person site visits planned and executed on-ground',
        'Ingestion breakdown: Facebook (12,524), 99Acres (1,218), WhatsApp Ads (763), MagicBricks (320), IVR (67)',
        'Speed-to-lead cut from 4 hours down to under 60 seconds with instant agent notifications',
        'Real estate consultancy sales velocity increased by 4.8x compared to manual spreadsheet follow-ups'
      ],
      adCampaign: 'Omnichannel Aggregation: Meta Ads + 99Acres + MagicBricks API + WhatsApp Business',
      sampleLead: {
        buyerProfile: 'Pankaj Mahajan (Self-Use Homebuyer)',
        budget: '₹85 Lakh - ₹1.10 Crore',
        timeline: 'Immediate (Visit requested within 48 hours)',
        intent: 'Bantalab House independent residential property',
        actionTaken: 'Status: "Visit Planned" & scheduled meeting within 2 days of initial ad click.'
      }
    },
    {
      id: 'khushiram',
      clientName: 'The Khushi Ram Realtors',
      category: 'luxury',
      categoryLabel: 'Commercial & High-Ticket Luxury',
      location: 'Mohali • Aerocity • New Chandigarh',
      projectType: 'Commercial Showrooms, Luxury Kothis & Investor Wealth Advisory',
      heroHeadline: '1,158 Inquiries & 384 Disclosed High-Ticket Budgets (₹70L to ₹1.5 Cr+) with Urgent "Visit This Week" Intent',
      summary: 'Filtering out casual lookers to deliver high-net-worth investors and NRI buyers for ready-to-move commercial showrooms and luxury kothis with strict budget pre-qualification.',
      logoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/d838c956-1761-4bce-9d91-32f3abecc222/1786701781439-d838c956-1761-4bce-9d91-32f3abecc222-1786701780401.jpg',
      brandColor: '#00284D',
      metrics: {
        totalLeads: '1,158+',
        qualificationRate: 'High Ticket',
        expertConnects: 'High Net-Worth',
        siteVisits: '31 Urgent',
        keyHighlightLabel: 'Budget Disclosed',
        keyHighlightValue: '384 Leads'
      },
      theChallenge: 'Khushi Ram advises serious investors on building long-term wealth (targeting ₹3,000+ Crore in investor assets). Standard ad campaigns attracted entry-level inquiries who could not afford high-yield commercial showrooms or ₹1 Cr+ independent kothis.',
      theSolution: 'Nobogent implemented strict Meta CAPI gated forms and AI video creatives tailored specifically for wealth creation. Forms forced buyers to explicitly state their budget range and expected visit window, filtering out 82% of unqualified traffic before it reached the advisor.',
      verifiedHighlights: [
        '1,158 total inquiries with 384 disclosing budgets between ₹70L to ₹1.5 Cr+',
        '31 immediate high-urgency buyers specifying "Visit This Week" in form submissions',
        'Zero ad spend wasted on tire-kickers with budget thresholds under ₹70 Lakhs',
        'Direct alignment with Khushi Ram’s mission of ethical, high-growth real estate advisory',
        'Hampten Heights & Aerocity commercial inventory showcased with dynamic CAPI video ads'
      ],
      adCampaign: 'Hampten Heights + Commercial Showrooms 1Cr+ / Video Creative CAPI Automation',
      sampleLead: {
        buyerProfile: 'Ajay Gupta (HNW Investor, Mohali)',
        budget: '₹1.00 Crore - ₹1.50 Crore (Verified)',
        timeline: 'This Week (Direct Site Visit Planned)',
        intent: 'Ready-to-move Commercial Showroom with high rental yield',
        actionTaken: 'Completed high-ticket budget verification, moved directly into "Visit Planned" CRM stage.'
      }
    },
    {
      id: 'bioque',
      clientName: 'Bioque Estates International',
      category: 'global',
      categoryLabel: 'Dubai & Ultra-HNW Luxury',
      location: 'Dubai (UAE) • Amritsar • New Chandigarh',
      projectType: 'Benghatti & DAMAC Violet 4 (AED 2.19M+) & Domestic Luxury (₹1.5–₹5 Cr)',
      heroHeadline: '1,085 Global Luxury Leads, 126 Ultra-HNW Investors & Instant Digital Brochure Delivery',
      summary: 'Selling multi-crore international and domestic luxury properties through automated digital brochure delivery, WhatsApp concierge qualification, and luxury advisor hand-offs.',
      logoUrl: 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/68b55a31-a16d-454d-a20f-11adabf590b0-bioque-logo.png',
      brandColor: '#0A192F',
      metrics: {
        totalLeads: '1,085+',
        qualificationRate: 'Ultra-HNW',
        expertConnects: 'Concierge',
        siteVisits: 'NRI / HNW',
        keyHighlightLabel: 'Luxury Budgets',
        keyHighlightValue: '₹1.5Cr – 5Cr'
      },
      theChallenge: 'Selling off-plan Dubai properties (Benghatti, DAMAC starting AED 2.194 Million) and domestic luxury plots in Omaxe Amritsar & New Chandigarh requires extreme brand prestige, instant digital collateral delivery, and frictionless communication across time zones.',
      theSolution: 'Nobogent designed high-converting luxury landing pages with instant WhatsApp PDF brochure delivery. The moment a prospect submits their query, Nobogent validates their budget tier (₹1.5 Cr to ₹5.0 Cr or AED 2M+) and connects them directly with an international property concierge.',
      verifiedHighlights: [
        '1,085 international and domestic luxury inquiries generated',
        '126 verified Ultra-HNW investors categorized into "Hot / Warm" high-ticket buyer tiers',
        'Instant digital brochure dispatch via WhatsApp with payment plans & ROI breakdowns',
        'Direct coverage of premier projects: DAMAC Violet Phase 3, Benghatti, and Omaxe New Chandigarh',
        'Seamless lead capture from both Meta Instant Forms and dedicated high-speed landing pages'
      ],
      adCampaign: 'Benghatti & DAMAC Dubai Luxury / Violet 4 Phase 3 4BR + Omaxe Amritsar & New Chandigarh',
      sampleLead: {
        buyerProfile: 'Sunita (NRI Luxury Investor)',
        budget: '₹1.50 Crore - ₹5.00 Crore (Verified)',
        timeline: 'Within 3 Months',
        intent: 'Omaxe New Chandigarh Flats & Commercial / Dubai Off-Plan Assets',
        actionTaken: 'Downloaded luxury brochure on WhatsApp, verified ₹1.5Cr+ budget, flagged as Hot Investor Lead.'
      }
    },
    {
      id: 'proestate',
      clientName: 'The ProEstate',
      category: 'luxury',
      categoryLabel: 'Prime Commercial & Luxury Kothis',
      location: 'Sector 7 Panchkula • Mohali • Zirakpur',
      projectType: '10-Marla Luxury Kothis, Commercial Plotted Assets & Wellness City',
      heroHeadline: '8,048 Verified Inquiries & 34+ Site Visits for High-End Sector 7 Panchkula Kothis',
      summary: 'Systematic lead acquisition and TeleCRM sync for premium residential kothis and commercial plotting in Panchkula’s most prestigious sectors.',
      logoText: 'The ProEstate',
      brandColor: '#1E293B',
      metrics: {
        totalLeads: '8,048+',
        qualificationRate: 'Verified',
        expertConnects: 'Direct CRM',
        siteVisits: '34+ Visits',
        keyHighlightLabel: 'Panchkula Inventory',
        keyHighlightValue: '10 Marla Kothis'
      },
      theChallenge: 'Capturing buyers with the financial capacity for Sector 7 Panchkula 10-marla independent luxury homes requires precise audience filtering and zero leakage between Facebook ad forms and tele-calling teams.',
      theSolution: 'Nobogent implemented automated CRM sync with instant custom field mapping, tracking every stage from first inquiry to planned site visits and completed inspections.',
      verifiedHighlights: [
        '8,048 total inquiries processed across dedicated project campaigns',
        'Sector 7 Panchkula 10-Marla luxury houses promoted with high-CTR creative angles',
        'Seamless integration with TeleCRM and multi-member agent round-robin distribution',
        '34 verified site visits planned and completed for high-ticket residential inventory',
        'Continuous audience optimization delivering stable cost-per-lead over multiple quarters'
      ],
      adCampaign: 'The ProEstate - 10 Marla House in Sector 7 Panchkula + The Wellness City',
      sampleLead: {
        buyerProfile: 'Manik (Panchkula Resident)',
        budget: '₹1.50 Crore+',
        timeline: 'Immediate Buyer',
        intent: '10 Marla Independent House in Sector 7 Panchkula',
        actionTaken: 'Status: "Visit Done" after on-ground site inspection with senior property advisor.'
      }
    }
  ]

  // Filter case studies by category
  const filteredCaseStudies = useMemo(() => {
    if (selectedCategory === 'all') return caseStudies
    return caseStudies.filter(c => c.category === selectedCategory)
  }, [selectedCategory])

  const activeCaseStudy = useMemo(() => {
    return caseStudies.find(c => c.id === activeTabId) || caseStudies[0]
  }, [activeTabId])

  // Interactive ROI Calculator Logic
  const calcResults = useMemo(() => {
    // Benchmark assumptions derived from Nobogent verified client metrics
    // Avg CPL in real estate with Meta CAPI: ~₹110
    const estLeads = Math.round(calcBudget / 110)
    // 56% qualification rate (as seen in Red Rose City)
    const qualifiedLeads = Math.round(estLeads * 0.54)
    // 10% of leads click "Connect with Expert"
    const expertClicks = Math.round(estLeads * 0.10)
    // ~15% of qualified leads plan/complete site visits (as seen across Blue Square & Khushi Ram)
    const projectedSiteVisits = Math.max(3, Math.round(qualifiedLeads * 0.16))
    // Projected pipeline value: visits * avgPrice (in Crores)
    const pipelineValueCr = ((projectedSiteVisits * calcAvgPrice) / 100).toFixed(1)
    // Estimated closings (1 in 8 site visits typically closes in real estate):
    const estClosings = Math.max(1, Math.round(projectedSiteVisits / 8))
    const grossCommissionLakhs = ((estClosings * calcAvgPrice * 0.02)).toFixed(1) // 2% broker commission

    return {
      estLeads,
      qualifiedLeads,
      expertClicks,
      projectedSiteVisits,
      pipelineValueCr,
      estClosings,
      grossCommissionLakhs
    }
  }, [calcBudget, calcAvgPrice])

  // Bot Demo Steps
  const botConversation = [
    {
      sender: 'bot',
      text: 'Namaste! 🏡 Welcome to Red Rose City by Alpine Nest Homes (Sector 9, Dera Bassi). I am your AI Property Assistant. What plot size are you looking for?',
      options: ['100 Sq. Yd.', '120 Sq. Yd.', '150 Sq. Yd.']
    },
    {
      sender: 'bot',
      text: 'Great choice! 📐 Our 100–150 sq. yd. plots feature wide 25-ft frontage and 4 green parks. What is your comfortable investment budget?',
      options: ['₹40L - ₹50L', '₹50L - ₹70L', 'Above ₹70L']
    },
    {
      sender: 'bot',
      text: 'Perfect! We have possession-ready plots available in that exact price band with immediate registry. When are you planning to visit the township?',
      options: ['This Weekend', 'Within 15 Days', 'Immediate']
    },
    {
      sender: 'bot',
      text: 'Awesome! 🎯 Your requirements are logged. Would you like to connect directly with our Township Specialist or schedule a guided site visit?',
      options: ['👨‍💼 Connect With Expert', '📅 Book Site Visit', '📄 Download Layout Map']
    }
  ]

  const handleBotOptionClick = (option: string) => {
    setBotSimulating(true)
    const updated = { ...botResponses, [botStep]: option }
    setBotResponses(updated)

    setTimeout(() => {
      setBotSimulating(false)
      if (botStep < botConversation.length - 1) {
        setBotStep(botStep + 1)
      } else {
        setBotStep(99) // Complete state
      }
    }, 600)
  }

  const handleResetBot = () => {
    setBotStep(0)
    setBotResponses({})
    setBotSimulating(false)
  }

  // Handle Contact Form Submission
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitError('')
    setSubmitSuccess(false)

    try {
      const fullMessage = `Client Results Page Inquiry\nProject/Firm: ${formProject}\nPreferred Budget: ${formBudget}\nTimeline: ${formTimeline}\nNotes: ${formNotes}`

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          email: formEmail || 'no-email-results@nobogent.com',
          phone: formPhone,
          message: fullMessage,
          budget: formBudget,
          timeline: formTimeline
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit inquiry')
      }

      setSubmitSuccess(true)
      setFormName('')
      setFormPhone('')
      setFormEmail('')
      setFormProject('')
      setFormNotes('')
    } catch (err: any) {
      setSubmitError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 selection:bg-[#B22B31] selection:text-white">
      {/* Navigation */}
      <LandingNavbar />

      {/* Main Content Spacer for fixed navbar */}
      <div className="pt-28 md:pt-32" />

      {/* TOP LIVE AUDIT BADGE STRIP */}
      <div className="bg-[#00284D] text-white py-2.5 px-4 text-xs font-semibold border-b border-[#003D6F]/40">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-extrabold text-emerald-400 uppercase tracking-wider text-[11px]">
              VERIFIED CLIENT AUDIT DATA
            </span>
            <span className="text-slate-300 hidden sm:inline">
              • 26,800+ Inquiries Analyzed Across Live Meta & WhatsApp Accounts
            </span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-300">
            <span className="hidden md:inline">Audited: October 2026</span>
            <a href="#case-studies-section" className="text-white hover:text-emerald-300 underline font-bold transition-colors">
              Jump To Case Studies ↓
            </a>
          </div>
        </div>
      </div>

      {/* HERO SECTION */}
      <section className="relative overflow-hidden pt-12 pb-20 md:pt-16 md:pb-28 bg-gradient-to-b from-[#F8F9FF] via-white to-white">
        {/* Background glow effects */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-gradient-to-tr from-[#003D6F]/10 via-[#B22B31]/5 to-transparent rounded-full blur-3xl -z-10 pointer-events-none" />

        <div className="max-w-[1400px] mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto space-y-6">
            {/* Pill Tag */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#003D6F]/10 border border-[#003D6F]/20 text-[#003D6F] text-xs font-extrabold uppercase tracking-wider shadow-sm">
              <Sparkles size={14} className="text-[#B22B31]" />
              Real Estate Proof & Performance Benchmarks
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black text-[#00284D] tracking-tight leading-[1.12]">
              How Real Estate Leaders Generate <br className="hidden sm:inline" />
              <span className="bg-gradient-to-r from-[#003D6F] via-[#B22B31] to-[#991B1B] bg-clip-text text-transparent">
                26,000+ Inquiries, 1,000+ Site Visits
              </span>{' '}
              <br className="hidden sm:inline" />
              & 50+ Direct "Connect with Expert" Bookings.
            </h1>

            {/* Subtitle */}
            <p className="text-base sm:text-lg md:text-xl text-slate-600 font-medium leading-relaxed max-w-3xl mx-auto">
              Stop bleeding ad spend on unverified phone numbers and casual scrollers. Here is the exact verified data, qualification workflows, and conversion funnels used by <strong>Red Rose City</strong>, <strong>Blue Square Infra</strong>, <strong>The Khushi Ram Realtors</strong>, and <strong>Bioque Estates</strong> to close high-ticket property inventory on autopilot.
            </p>

            {/* CTA Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="#lead-form-section"
                className="w-full sm:w-auto px-8 py-4 bg-[#B22B31] hover:bg-[#902227] text-white font-extrabold text-base rounded-full shadow-[0_12px_28px_-6px_rgba(178,43,49,0.45)] active:scale-95 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
              >
                Get A Free Real Estate Marketing Audit <ArrowRight size={18} />
              </a>
              <a
                href="#roi-calculator"
                className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-slate-50 text-[#003D6F] font-extrabold text-base rounded-full border-2 border-[#003D6F]/20 hover:border-[#003D6F] shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                Calculate Your Projected ROI <TrendingUp size={18} className="text-[#003D6F]" />
              </a>
            </div>

            {/* Trust Micro-Bullets */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500 font-bold">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> Meta Conversions API (CAPI) Verified
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> WhatsApp Official Cloud API Native
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> 100% Real Live CRM Data
              </div>
            </div>
          </div>

          {/* KEY PERFORMANCE STATS BAR (4 Big Stat Cards) */}
          <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Stat 1 */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-[#003D6F]" />
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Total Inquiries</span>
                <Users size={18} className="text-[#003D6F]" />
              </div>
              <div className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">26,800+</div>
              <p className="text-xs text-slate-500 mt-1 font-semibold">Across Meta Ads, WhatsApp & Portals</p>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                <TrendingUp size={12} /> Real verified leads
              </div>
            </div>

            {/* Stat 2 */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-[#B22B31]" />
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Site Visits Logged</span>
                <Calendar size={18} className="text-[#B22B31]" />
              </div>
              <div className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">1,000+</div>
              <p className="text-xs text-slate-500 mt-1 font-semibold">On-Ground Face-to-Face Visits</p>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#003D6F] bg-blue-50 px-2 py-0.5 rounded-md">
                <Building2 size={12} /> High-intent buyers
              </div>
            </div>

            {/* Stat 3 */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500" />
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">AI Qualification Rate</span>
                <Bot size={18} className="text-emerald-600" />
              </div>
              <div className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">56.0%</div>
              <p className="text-xs text-slate-500 mt-1 font-semibold">Verified Budget & Timeline</p>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md">
                <Zap size={12} /> WhatsApp Bot Powered
              </div>
            </div>

            {/* Stat 4 */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-amber-500" />
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Speed-To-Lead</span>
                <Clock size={18} className="text-amber-500" />
              </div>
              <div className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">&lt; 30 sec</div>
              <p className="text-xs text-slate-500 mt-1 font-semibold">Instant Automated Engagement</p>
              <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                <ShieldCheck size={12} /> Zero Lead Leakage
              </div>
            </div>
          </div>

          {/* CLIENT LOGO STRIP */}
          <div className="mt-14 pt-10 border-t border-slate-200/70 text-center">
            <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-6">
              VERIFIED CAMPAIGNS POWERED BY NOBOGENT AI
            </p>
            <div className="flex flex-wrap items-center justify-center gap-8 md:gap-14 opacity-90">
              <div className="flex items-center gap-3">
                <img
                  src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/c3893924-5a57-4da3-b4bc-7c70d8ee7c59/1788432741401-c3893924-5a57-4da3-b4bc-7c70d8ee7c59-1788432740101.jpg"
                  alt="Red Rose City"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm"
                />
                <span className="font-extrabold text-sm text-[#00284D]">Red Rose City</span>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/logos/2f62a259-f23b-48ee-a920-c436f36eaa4b/1785305575571-2f62a259-f23b-48ee-a920-c436f36eaa4b-1785305574448.jpg"
                  alt="Blue Square Infra"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm"
                />
                <span className="font-extrabold text-sm text-[#00284D]">Blue Square Infra</span>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/d838c956-1761-4bce-9d91-32f3abecc222/1786701781439-d838c956-1761-4bce-9d91-32f3abecc222-1786701780401.jpg"
                  alt="The Khushi Ram Realtors"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm"
                />
                <span className="font-extrabold text-sm text-[#00284D]">The Khushi Ram Realtors</span>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/68b55a31-a16d-454d-a20f-11adabf590b0-bioque-logo.png"
                  alt="Bioque Estates International"
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-sm"
                />
                <span className="font-extrabold text-sm text-[#00284D]">Bioque Estates (Dubai & Tricity)</span>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#1E293B] flex items-center justify-center text-white font-black text-xs shadow-sm">
                  PE
                </div>
                <span className="font-extrabold text-sm text-[#00284D]">The ProEstate</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DETAILED CASE STUDIES SECTION */}
      <section id="case-studies-section" className="py-20 bg-slate-50/60 border-y border-slate-200/80">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-extrabold uppercase tracking-wider">
              Deep-Dive Client Breakdowns
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">
              Verified Case Studies: Numbers You Can Verify
            </h2>
            <p className="text-slate-600 font-medium text-base">
              Explore how each partner utilized Nobogent's AI Marketing Suite, Conversational WhatsApp Bots, and Meta CAPI to eliminate junk leads and maximize on-ground site visits.
            </p>
          </div>

          {/* CATEGORY FILTER TABS */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
            {[
              { id: 'all', label: 'All Case Studies (5)' },
              { id: 'township', label: '🏡 Plotted Townships' },
              { id: 'omnichannel', label: '⚡ Omnichannel CRM' },
              { id: 'luxury', label: '💎 High-Ticket & Kothis' },
              { id: 'global', label: '🇦🇪 Dubai & NRI Advisory' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  setSelectedCategory(tab.id as CaseStudyCategory)
                }}
                className={`px-5 py-2.5 rounded-full text-xs font-black transition-all cursor-pointer ${
                  selectedCategory === tab.id
                    ? 'bg-[#003D6F] text-white shadow-sm'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* CLIENT SELECTOR PILLS */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-12">
            {filteredCaseStudies.map(cs => (
              <button
                key={cs.id}
                onClick={() => setActiveTabId(cs.id)}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-xs font-extrabold transition-all cursor-pointer ${
                  activeTabId === cs.id
                    ? 'bg-white border-[#B22B31] text-[#B22B31] shadow-md ring-2 ring-[#B22B31]/10'
                    : 'bg-white/80 border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {cs.logoUrl ? (
                  <img src={cs.logoUrl} alt={cs.clientName} className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-black">
                    {cs.clientName[0]}
                  </div>
                )}
                {cs.clientName}
                {activeTabId === cs.id && (
                  <span className="w-2 h-2 rounded-full bg-[#B22B31]" />
                )}
              </button>
            ))}
          </div>

          {/* ACTIVE CASE STUDY HERO CARD */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden transition-all">
            {/* Header banner */}
            <div className="p-6 sm:p-8 md:p-10 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-slate-50">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    {activeCaseStudy.logoUrl ? (
                      <img
                        src={activeCaseStudy.logoUrl}
                        alt={activeCaseStudy.clientName}
                        className="w-12 h-12 rounded-2xl object-cover border border-slate-200 shadow-sm"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-[#00284D] text-white flex items-center justify-center font-black text-sm">
                        {activeCaseStudy.clientName.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-xl sm:text-2xl font-black text-[#00284D]">
                          {activeCaseStudy.clientName}
                        </h3>
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold text-[10px] uppercase">
                          {activeCaseStudy.categoryLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-semibold flex items-center gap-1.5 mt-0.5">
                        <MapPin size={13} className="text-[#B22B31]" /> {activeCaseStudy.location}
                      </p>
                    </div>
                  </div>

                  <h4 className="text-xl sm:text-2xl font-black text-[#003D6F] leading-snug max-w-3xl">
                    {activeCaseStudy.heroHeadline}
                  </h4>
                  <p className="text-sm text-slate-600 font-medium leading-relaxed max-w-3xl">
                    {activeCaseStudy.summary}
                  </p>
                </div>

                {/* Direct Action for this client */}
                <div className="shrink-0 lg:text-right space-y-2">
                  <div className="text-xs font-black uppercase tracking-wider text-slate-400">
                    Campaign Scope
                  </div>
                  <div className="text-sm font-extrabold text-[#00284D] bg-slate-100 px-3.5 py-2 rounded-xl inline-block">
                    {activeCaseStudy.projectType}
                  </div>
                  <div>
                    <a
                      href="#lead-form-section"
                      className="inline-flex items-center gap-2 text-xs font-black text-[#B22B31] hover:text-[#902227] hover:underline cursor-pointer"
                    >
                      Deploy this blueprint for your project <ChevronRight size={14} />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* METRICS STRIP FOR ACTIVE CLIENT */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border-b border-slate-100 bg-[#00284D] text-white divide-x divide-white/10">
              <div className="p-4 sm:p-5 text-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 block">Total Inquiries</span>
                <span className="text-xl sm:text-2xl font-black text-white">{activeCaseStudy.metrics.totalLeads}</span>
              </div>
              <div className="p-4 sm:p-5 text-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 block">Qualification</span>
                <span className="text-xl sm:text-2xl font-black text-emerald-400">{activeCaseStudy.metrics.qualificationRate}</span>
              </div>
              <div className="p-4 sm:p-5 text-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 block">Expert Connect</span>
                <span className="text-xl sm:text-2xl font-black text-amber-300">{activeCaseStudy.metrics.expertConnects}</span>
              </div>
              <div className="p-4 sm:p-5 text-center">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 block">Site Visits</span>
                <span className="text-xl sm:text-2xl font-black text-white">{activeCaseStudy.metrics.siteVisits}</span>
              </div>
              <div className="p-4 sm:p-5 text-center col-span-2 sm:col-span-1 lg:col-span-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-300 block">
                  {activeCaseStudy.metrics.keyHighlightLabel}
                </span>
                <span className="text-xl sm:text-2xl font-black text-emerald-300">
                  {activeCaseStudy.metrics.keyHighlightValue}
                </span>
              </div>
            </div>

            {/* DEEP DIVE BODY: The Challenge vs The Nobogent Solution */}
            <div className="p-6 sm:p-8 md:p-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Challenge & Solution */}
              <div className="lg:col-span-7 space-y-6">
                {/* Challenge */}
                <div className="bg-red-50/60 border border-red-100 rounded-2xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-black text-red-700 uppercase tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-red-600" />
                    The Pre-Nobogent Challenge
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                    {activeCaseStudy.theChallenge}
                  </p>
                </div>

                {/* Solution */}
                <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-5 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-black text-emerald-700 uppercase tracking-wider">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    The Nobogent AI Marketing Engine
                  </div>
                  <p className="text-xs sm:text-sm text-slate-700 font-medium leading-relaxed">
                    {activeCaseStudy.theSolution}
                  </p>
                </div>

                {/* Verified Bullet Highlights */}
                <div className="space-y-3 pt-2">
                  <h5 className="text-xs font-black uppercase tracking-wider text-[#00284D]">
                    Verified Key Highlights & Impact
                  </h5>
                  <div className="space-y-2.5">
                    {activeCaseStudy.verifiedHighlights.map((hl, i) => (
                      <div key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 font-medium">
                        <CheckCircle2 size={16} className="text-[#B22B31] shrink-0 mt-0.5" />
                        <span>{hl}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Live Proof Snippet & Lead Inspection */}
              <div className="lg:col-span-5 space-y-6">
                {/* Verified Sample Lead Inspector Box */}
                <div className="bg-slate-900 text-white rounded-2xl p-5 space-y-4 border border-slate-800 shadow-lg">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="text-xs font-black text-emerald-400 uppercase tracking-wider">
                        Live CRM Lead Sample
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">100% Anonymized Proof</span>
                  </div>

                  <div className="space-y-2.5 text-xs font-medium">
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Buyer Profile</span>
                      <span className="font-bold text-white">{activeCaseStudy.sampleLead.buyerProfile}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Disclosed Budget</span>
                      <span className="font-bold text-emerald-300">{activeCaseStudy.sampleLead.budget}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Purchase Timeline</span>
                      <span className="font-bold text-amber-300">{activeCaseStudy.sampleLead.timeline}</span>
                    </div>
                    <div className="py-1 border-b border-slate-800/60">
                      <span className="text-slate-400 block mb-1">Target Property Intent</span>
                      <span className="text-white text-[11px] leading-tight block">{activeCaseStudy.sampleLead.intent}</span>
                    </div>
                    <div className="py-1 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
                      <span className="text-emerald-400 text-[10px] uppercase font-bold block mb-1">
                        Automated AI Action Taken:
                      </span>
                      <span className="text-slate-200 text-xs leading-relaxed block">
                        {activeCaseStudy.sampleLead.actionTaken}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 text-center border-t border-slate-800">
                    <a
                      href="#interactive-bot-demo"
                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-white hover:text-emerald-300 transition-colors"
                    >
                      <Bot size={14} /> Try The WhatsApp Bot Simulator Below ↓
                    </a>
                  </div>
                </div>

                {/* Campaign attribution note */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[11px] text-slate-500 font-medium">
                  <span className="font-black text-[#00284D] block mb-1">Meta Ad Campaign Origin:</span>
                  <span className="font-mono text-slate-700 break-all">{activeCaseStudy.adCampaign}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTERACTIVE WHATSAPP BOT DEMO SANDBOX */}
      <section id="interactive-bot-demo" className="py-20 bg-white">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left: Explainer */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-extrabold uppercase tracking-wider">
                <Bot size={14} /> Conversational Speed-To-Lead Engine
              </div>

              <h2 className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight leading-tight">
                See Why WhatsApp Bots Deliver <br />
                <span className="text-[#B22B31]">53+ "Connect With Expert" Clicks</span> & Pre-Booked Visits
              </h2>

              <p className="text-slate-600 font-medium text-base leading-relaxed">
                When a buyer clicks your Meta Ad, they don't want to wait 4 hours for a sales rep to call while they are driving or in a meeting. Nobogent's Conversational AI engages them on WhatsApp in under 15 seconds.
              </p>

              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <h5 className="font-extrabold text-sm text-[#00284D]">Zero Form Fatigue</h5>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      1-tap WhatsApp interactive quick-reply buttons eliminate tedious typing, yielding 3x higher response rates.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-[#003D6F] flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    <h5 className="font-extrabold text-sm text-[#00284D]">Direct "Connect With Expert" Handoff</h5>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Once budget is validated, serious buyers click "Connect With Expert", immediately triggering an instant push alert and phone call.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <h5 className="font-extrabold text-sm text-[#00284D]">Automated CRM Staging</h5>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Leads are auto-scored into Hot, Warm, or Cold tiers, preventing your team from chasing dead leads.
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <a
                  href="#lead-form-section"
                  className="inline-flex items-center gap-2 px-6 py-3.5 bg-[#003D6F] hover:bg-[#00284D] text-white font-extrabold text-xs rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Get This Bot Configured For Your Projects <ArrowRight size={14} />
                </a>
              </div>
            </div>

            {/* Right: Live Interactive Smartphone Simulator */}
            <div className="lg:col-span-6 flex justify-center">
              <div className="w-full max-w-sm bg-[#0C1317] rounded-[2.5rem] p-3 shadow-2xl border-4 border-slate-800 relative">
                {/* Smartphone Speaker notch */}
                <div className="absolute top-5 left-1/2 -translate-x-1/2 w-28 h-4 bg-slate-900 rounded-full z-20 flex items-center justify-center">
                  <div className="w-10 h-1 bg-slate-700 rounded-full" />
                </div>

                {/* Smartphone Inner Screen */}
                <div className="bg-[#EFEAE2] rounded-[2rem] overflow-hidden flex flex-col h-[560px] text-slate-900 relative">
                  {/* WhatsApp Header */}
                  <div className="bg-[#005C4B] text-white p-3 pt-7 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-2.5">
                      <img
                        src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/c3893924-5a57-4da3-b4bc-7c70d8ee7c59/1788432741401-c3893924-5a57-4da3-b4bc-7c70d8ee7c59-1788432740101.jpg"
                        alt="Red Rose City Bot"
                        className="w-8 h-8 rounded-full object-cover border border-white/20"
                      />
                      <div>
                        <div className="text-xs font-black leading-tight flex items-center gap-1">
                          Red Rose City AI
                          <CheckCircle2 size={11} className="text-emerald-300" />
                        </div>
                        <div className="text-[10px] text-emerald-200">Online • Verified Business</div>
                      </div>
                    </div>
                    <button
                      onClick={handleResetBot}
                      className="text-[10px] text-white/80 hover:text-white bg-white/10 px-2 py-1 rounded cursor-pointer"
                    >
                      Reset Demo
                    </button>
                  </div>

                  {/* Chat Message Scroll Area */}
                  <div className="flex-1 p-3.5 space-y-3 overflow-y-auto">
                    {/* Timestamp Pill */}
                    <div className="text-center">
                      <span className="bg-white/80 text-slate-500 text-[10px] font-bold px-2.5 py-0.5 rounded-md shadow-xs">
                        TODAY (INCOMING AD CLICK)
                      </span>
                    </div>

                    {/* Rendered Conversation Steps */}
                    {botConversation.slice(0, botStep + 1).map((msg, idx) => (
                      <React.Fragment key={idx}>
                        {/* Bot Message */}
                        <div className="flex items-end gap-1.5 max-w-[85%]">
                          <div className="bg-white p-3 rounded-2xl rounded-bl-xs shadow-sm text-xs text-slate-800 leading-relaxed border border-slate-100 space-y-2">
                            <p className="font-medium">{msg.text}</p>
                            <span className="text-[9px] text-slate-400 text-right block">Just now</span>
                          </div>
                        </div>

                        {/* User Response if already chosen */}
                        {botResponses[idx] && (
                          <div className="flex justify-end">
                            <div className="bg-[#D9FDD3] p-2.5 rounded-2xl rounded-br-xs shadow-sm text-xs font-extrabold text-slate-900 leading-snug border border-emerald-200/50">
                              {botResponses[idx]}
                              <span className="text-[9px] text-emerald-700 text-right block mt-0.5">✓✓</span>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}

                    {/* Bot Simulating Typing indicator */}
                    {botSimulating && (
                      <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-2xl shadow-sm w-fit text-slate-400 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0.4s]" />
                        <span className="text-[10px] ml-1">AI is qualifying...</span>
                      </div>
                    )}

                    {/* Completed State */}
                    {botStep === 99 && (
                      <div className="bg-emerald-100 border border-emerald-300 rounded-xl p-3 text-center space-y-1">
                        <div className="text-xs font-black text-emerald-800">🎉 Lead Tier: HOT (Score 70/100)</div>
                        <p className="text-[11px] text-emerald-700 leading-tight">
                          Lead qualified with budget & timeline. Instant Push Notification sent to Sales Director's phone!
                        </p>
                      </div>
                    )}
                  </div>

                  {/* WhatsApp Interactive Quick Reply Buttons Area */}
                  {botStep < botConversation.length && !botSimulating && (
                    <div className="p-3 bg-white/90 backdrop-blur-sm border-t border-slate-200 space-y-1.5">
                      <div className="text-[10px] text-center font-bold text-slate-500 uppercase">
                        Tap an option below to test the bot:
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {botConversation[botStep].options.map((opt, i) => (
                          <button
                            key={i}
                            onClick={() => handleBotOptionClick(opt)}
                            className="w-full py-2 px-3 bg-[#E7F0FF] hover:bg-[#D0E8FF] text-[#003D6F] text-xs font-extrabold rounded-xl border border-blue-200 transition-all text-center cursor-pointer active:scale-98 shadow-xs"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {botStep === 99 && (
                    <div className="p-3 bg-white border-t border-slate-200 text-center">
                      <button
                        onClick={handleResetBot}
                        className="py-2 px-4 bg-[#005C4B] text-white text-xs font-black rounded-xl cursor-pointer"
                      >
                        🔄 Test Bot Again
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HEAD-TO-HEAD COMPARISON MATRIX */}
      <section className="py-20 bg-slate-50 border-y border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-50 border border-red-200 text-[#B22B31] text-[11px] font-extrabold uppercase tracking-wider">
              Why Nobogent Out-Converts
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">
              Nobogent AI Engine vs Traditional Agencies
            </h2>
            <p className="text-slate-600 font-medium text-base">
              Why builders and realtors who switch from retainers to Nobogent see a 4x jump in on-ground site visits.
            </p>
          </div>

          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="grid grid-cols-12 bg-[#00284D] text-white p-4 sm:p-5 font-black text-xs sm:text-sm uppercase tracking-wider">
              <div className="col-span-5 sm:col-span-4">Feature / Metric</div>
              <div className="col-span-3 sm:col-span-4 text-center text-red-300">Traditional Agency</div>
              <div className="col-span-4 text-center text-emerald-400">Nobogent AI Engine</div>
            </div>

            <div className="divide-y divide-slate-100 text-xs sm:text-sm font-medium">
              {[
                {
                  feature: 'Speed-to-Lead Response',
                  agency: '4 to 12 Hours (Manual Calling)',
                  agencyBad: true,
                  nobogent: 'Under 15 Seconds (WhatsApp AI)',
                  nobogentGood: true
                },
                {
                  feature: 'Lead Pre-Qualification',
                  agency: 'Unfiltered form with fake phone numbers',
                  agencyBad: true,
                  nobogent: 'Automated Budget & Timeline gating',
                  nobogentGood: true
                },
                {
                  feature: '"Connect with Expert" Handoff',
                  agency: 'None. Reps cold-call unprompted',
                  agencyBad: true,
                  nobogent: 'Direct 1-tap buyer button trigger',
                  nobogentGood: true
                },
                {
                  feature: 'Site Visit Scheduling',
                  agency: 'Back-and-forth phone ping-pong',
                  agencyBad: true,
                  nobogent: 'Automated Google Calendar & slot pick',
                  nobogentGood: true
                },
                {
                  feature: 'Tracking & Attribution',
                  agency: 'Browser-based pixels (80% blocked by iOS)',
                  agencyBad: true,
                  nobogent: 'Server-Side Conversions API (CAPI)',
                  nobogentGood: true
                },
                {
                  feature: 'Portal Consolidation',
                  agency: 'Messy manual Excel spreadsheets',
                  agencyBad: true,
                  nobogent: 'Unified CRM (Meta + 99Acres + Portals)',
                  nobogentGood: true
                },
                {
                  feature: 'Cost & Retainers',
                  agency: '₹40k–₹1L/month bloated agency fee',
                  agencyBad: true,
                  nobogent: 'Autonomous AI suite + Direct ROI',
                  nobogentGood: true
                }
              ].map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 p-4 sm:p-5 items-center hover:bg-slate-50/70 transition-colors">
                  <div className="col-span-5 sm:col-span-4 font-black text-[#00284D]">
                    {row.feature}
                  </div>
                  <div className="col-span-3 sm:col-span-4 text-center text-slate-500 font-semibold px-2">
                    <span className="inline-block text-red-600 mr-1.5 font-bold">✕</span>
                    {row.agency}
                  </div>
                  <div className="col-span-4 text-center font-extrabold text-emerald-700 bg-emerald-50/70 py-2 rounded-xl px-2">
                    <span className="inline-block text-emerald-600 mr-1.5 font-bold">✓</span>
                    {row.nobogent}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* INTERACTIVE REAL ESTATE ROI & PIPELINE CALCULATOR */}
      <section id="roi-calculator" className="py-20 bg-white">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#003D6F] text-[11px] font-extrabold uppercase tracking-wider">
              <DollarSign size={14} /> Interactive Pipeline Model
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">
              Real Estate ROI & Site Visit Calculator
            </h2>
            <p className="text-slate-600 font-medium text-base">
              Slide your monthly Meta ad spend and average property ticket size to project inquiries, qualified leads, and closing potential based on verified Nobogent client benchmarks.
            </p>
          </div>

          <div className="max-w-5xl mx-auto bg-gradient-to-br from-[#F8F9FF] to-white rounded-3xl border border-slate-200 shadow-xl p-6 sm:p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
            {/* Left: Input Sliders */}
            <div className="lg:col-span-6 space-y-8">
              {/* Slider 1: Ad Budget */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-600">
                    Monthly Meta Ad Budget
                  </label>
                  <span className="text-lg font-black text-[#003D6F] bg-blue-50 px-3 py-1 rounded-xl">
                    ₹{calcBudget.toLocaleString('en-IN')}
                  </span>
                </div>
                <input
                  type="range"
                  min={20000}
                  max={500000}
                  step={10000}
                  value={calcBudget}
                  onChange={(e) => setCalcBudget(Number(e.target.value))}
                  className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#003D6F]"
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                  <span>₹20,000 (Starter)</span>
                  <span>₹2,50,000 (Growth)</span>
                  <span>₹5,00,000 (Enterprise)</span>
                </div>
              </div>

              {/* Slider 2: Average Property Price */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-600">
                    Average Property Ticket Size
                  </label>
                  <span className="text-lg font-black text-[#B22B31] bg-red-50 px-3 py-1 rounded-xl">
                    ₹{calcAvgPrice} Lakhs
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={400}
                  step={5}
                  value={calcAvgPrice}
                  onChange={(e) => setCalcAvgPrice(Number(e.target.value))}
                  className="w-full h-2.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#B22B31]"
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-bold">
                  <span>₹30 Lakhs (Affordable)</span>
                  <span>₹1.50 Crore (Luxury)</span>
                  <span>₹4.00 Crore (High HNW)</span>
                </div>
              </div>

              {/* Benchmark Note */}
              <div className="bg-slate-100/80 rounded-2xl p-4 text-xs text-slate-500 font-medium space-y-1">
                <span className="font-bold text-slate-700 block">📊 Benchmark Assumptions:</span>
                <p>• Estimated CPL with CAPI: ~₹110 per verified inquiry.</p>
                <p>• AI Qualification Rate: 54% (budget & timeline confirmed).</p>
                <p>• Direct "Connect with Expert" rate: ~10% of total leads.</p>
                <p>• Site Visit conversion: ~16% of qualified buyers.</p>
              </div>
            </div>

            {/* Right: Calculated Outputs Card */}
            <div className="lg:col-span-6 bg-[#00284D] text-white rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-6 shadow-lg">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-400 block mb-1">
                  PROJECTED MONTHLY PERFORMANCE
                </span>
                <h4 className="text-2xl font-black text-white tracking-tight">
                  Your Real Estate Pipeline Projection
                </h4>
              </div>

              {/* Grid of Results */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
                  <span className="text-[10px] text-slate-300 font-bold uppercase block">Est. Total Inquiries</span>
                  <span className="text-2xl font-black text-white">{calcResults.estLeads}</span>
                  <span className="text-[10px] text-slate-400 block">Across WhatsApp & CAPI</span>
                </div>

                <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
                  <span className="text-[10px] text-slate-300 font-bold uppercase block">AI-Qualified Buyers</span>
                  <span className="text-2xl font-black text-emerald-300">{calcResults.qualifiedLeads}</span>
                  <span className="text-[10px] text-slate-400 block">Budget & Date Verified</span>
                </div>

                <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
                  <span className="text-[10px] text-slate-300 font-bold uppercase block">"Connect with Expert"</span>
                  <span className="text-2xl font-black text-amber-300">{calcResults.expertClicks} Clicks</span>
                  <span className="text-[10px] text-slate-400 block">Instant Sales Calls</span>
                </div>

                <div className="bg-white/10 rounded-xl p-3.5 border border-white/10">
                  <span className="text-[10px] text-slate-300 font-bold uppercase block">Scheduled Site Visits</span>
                  <span className="text-2xl font-black text-white">{calcResults.projectedSiteVisits} Visits</span>
                  <span className="text-[10px] text-slate-400 block">On-Ground Attendance</span>
                </div>
              </div>

              {/* Pipeline Value Callout */}
              <div className="bg-emerald-950/60 border border-emerald-500/30 rounded-xl p-4 text-center">
                <span className="text-[10px] uppercase font-extrabold text-emerald-400 tracking-wider block">
                  Projected Active Pipeline Value
                </span>
                <div className="text-3xl font-black text-white mt-0.5">
                  ₹{calcResults.pipelineValueCr} Crore
                </div>
                <span className="text-[11px] text-emerald-200 block mt-1">
                  Est. {calcResults.estClosings} closings (~₹{calcResults.grossCommissionLakhs}L brokerage/sales commission)
                </span>
              </div>

              <a
                href="#lead-form-section"
                className="w-full py-4 bg-[#B22B31] hover:bg-[#902227] text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md text-center block cursor-pointer"
              >
                Claim Your Custom Real Estate Growth Blueprint →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* LEAD CAPTURE / STRATEGY AUDIT FORM SECTION */}
      <section id="lead-form-section" className="py-20 bg-slate-50 border-t border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="max-w-4xl mx-auto bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12">
            {/* Left Side: Pitch & Proof */}
            <div className="md:col-span-5 bg-[#00284D] text-white p-8 sm:p-10 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-[10px] font-black uppercase tracking-wider">
                  <Sparkles size={12} /> Confidential Consultation
                </div>
                <h3 className="text-2xl sm:text-3xl font-black text-white leading-tight">
                  Ready to Scale Your Real Estate Inquiries?
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 font-medium leading-relaxed">
                  Book a 1-on-1 walkthrough with Nobogent’s Real Estate Growth Team. We will audit your existing Meta ads, show you our WhatsApp bot templates, and project your cost per site visit.
                </p>

                <div className="space-y-3 pt-2 text-xs font-semibold text-slate-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span>Free Meta Ad Account & CAPI Audit</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span>WhatsApp Bot Template tailored for your project</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span>Zero commitment, 100% actionable blueprint</span>
                  </div>
                </div>
              </div>

              {/* Direct WhatsApp Callout */}
              <div className="pt-4 border-t border-white/10 space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Need an immediate answer?
                </span>
                <a
                  href="https://wa.me/919872669935"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs font-black text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <MessageSquare size={14} /> WhatsApp Us Directly: +91 98726 69935
                </a>
              </div>
            </div>

            {/* Right Side: Form */}
            <div className="md:col-span-7 p-8 sm:p-10 flex flex-col justify-center">
              {submitSuccess ? (
                <div className="text-center py-8 space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 rounded-full flex items-center justify-center text-emerald-600 mx-auto">
                    <CheckCircle2 size={32} />
                  </div>
                  <h4 className="text-2xl font-black text-[#00284D]">Audit Request Received!</h4>
                  <p className="text-xs sm:text-sm text-slate-600 font-medium max-w-sm mx-auto leading-relaxed">
                    Thank you! Your project details have been logged into Nobogent CRM. Our Senior Real Estate Growth Strategist will WhatsApp/call you within 2 business hours.
                  </p>
                  <button
                    onClick={() => setSubmitSuccess(false)}
                    className="px-6 py-2.5 bg-[#003D6F] text-white text-xs font-black rounded-xl cursor-pointer"
                  >
                    Submit Another Inquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleFormSubmit} className="space-y-4">
                  <div>
                    <h4 className="text-xl font-black text-[#00284D]">Request Your Real Estate Growth Blueprint</h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Enter your details below to schedule your live campaign demonstration.
                    </p>
                  </div>

                  {submitError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl">
                      {submitError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Rajesh Kumar"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#00284D] focus:outline-none focus:border-[#003D6F]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        WhatsApp Number *
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="+91 98765 43210"
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#00284D] focus:outline-none focus:border-[#003D6F]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Project / Business Name *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Royal City Plots / ABC Realty"
                        value={formProject}
                        onChange={(e) => setFormProject(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#00284D] focus:outline-none focus:border-[#003D6F]"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                        Work Email (Optional)
                      </label>
                      <input
                        type="email"
                        placeholder="name@company.com"
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-[#00284D] focus:outline-none focus:border-[#003D6F]"
                      />
                    </div>
                  </div>

                  {/* Monthly Ad Spend Selection */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Planned Monthly Marketing Budget
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {['₹25k - ₹50k', '₹50k - ₹1.5L', '₹1.5L+'].map((opt) => (
                        <button
                          type="button"
                          key={opt}
                          onClick={() => setFormBudget(opt)}
                          className={`py-2 text-xs font-black rounded-xl border text-center transition-all cursor-pointer ${
                            formBudget === opt
                              ? 'bg-[#003D6F] text-white border-[#003D6F]'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Specific Goals / Current Pain Points
                    </label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Want more direct site visits for our residential plots in Mohali, getting junk leads currently..."
                      value={formNotes}
                      onChange={(e) => setFormNotes(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-bold text-[#00284D] focus:outline-none focus:border-[#003D6F]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-4 bg-[#B22B31] hover:bg-[#902227] disabled:bg-slate-400 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Submitting Request...
                      </>
                    ) : (
                      <>
                        Request Real Estate Blueprint Now <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <div className="text-center text-[10px] text-slate-400 font-bold">
                    🔒 We respect your privacy. No spam. Direct CRM notification sent upon submission.
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FREQUENTLY ASKED QUESTIONS (CRO FAQ ACCORDION) */}
      <section className="py-20 bg-white border-t border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-extrabold uppercase tracking-wider">
              Common Questions
            </div>
            <h2 className="text-3xl sm:text-4xl font-black text-[#00284D] tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-slate-600 font-medium text-base">
              Everything builders, township developers, and real estate brokers ask before launching with Nobogent.
            </p>
          </div>

          <div className="max-w-3xl mx-auto space-y-3">
            {[
              {
                q: 'How does the WhatsApp AI bot filter out casual or fake leads?',
                a: 'Traditional lead forms suffer from "accidental tap" leads who do not remember filling the form. Nobogent immediately messages the lead on WhatsApp within 15 seconds. The bot presents structured 1-tap buttons for plot size, budget ranges, and purchase timeline. Uninterested buyers bounce immediately, while serious buyers answer the prompts. Only leads who verify their budget and timeline are assigned to your sales reps.'
              },
              {
                q: 'What is the "Connect with Expert" button and why does it convert so well?',
                a: 'In campaigns like Red Rose City, after a lead answers their budget (e.g. ₹60L - ₹70L), the bot displays an interactive button: [Connect With Expert]. Clicks on this button represent extreme purchase intent—the buyer is actively requesting a phone call from a human specialist right now. Nobogent sends an instant push notification to your phone so you can call them while they are still holding their device.'
              },
              {
                q: 'Can Nobogent integrate with our existing Meta Ad Account and portals?',
                a: 'Yes. You can connect your existing Meta Business Manager and Meta Pixel. Nobogent configures server-side Conversions API (CAPI) to bypass iOS cookie blockers. Furthermore, as demonstrated with Blue Square Infra, we ingest leads from 99Acres, MagicBricks, Housing, and WhatsApp ads simultaneously into one centralized dashboard.'
              },
              {
                q: 'How quickly can our real estate campaigns go live?',
                a: 'Once your project brochure, pricing sheet, and location details are provided, our automated creative engine generates CAPI-ready ad graphics, video variations, and qualification bot flows within 24 to 48 hours.'
              },
              {
                q: 'What typical cost per site visit do real estate clients experience?',
                a: 'While costs vary by location and ticket size, our partners typically see qualified cost-per-lead (CPL) between ₹90 to ₹160, with on-ground verified site visits costing between ₹900 to ₹1,800. For high-ticket properties (such as ₹1.5 Cr+ kothis or commercial showrooms), the ROI on a single closing covers advertising costs for months.'
              }
            ].map((faq, idx) => (
              <div
                key={idx}
                className="border border-slate-200 rounded-2xl overflow-hidden transition-all bg-white"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-5 text-left flex items-center justify-between gap-4 font-black text-sm text-[#00284D] hover:text-[#B22B31] transition-colors cursor-pointer"
                >
                  <span>{faq.q}</span>
                  {openFaq === idx ? (
                    <ChevronUp size={18} className="text-[#B22B31] shrink-0" />
                  ) : (
                    <ChevronDown size={18} className="text-slate-400 shrink-0" />
                  )}
                </button>
                {openFaq === idx && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-slate-600 font-medium leading-relaxed border-t border-slate-100 pt-3">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL HIGH-CONVERTING BOTTOM CTA */}
      <section className="py-20 bg-gradient-to-r from-[#00284D] via-[#003D6F] to-[#00284D] text-white text-center">
        <div className="max-w-4xl mx-auto px-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-emerald-300 text-[11px] font-black uppercase tracking-wider">
            Ready For Predictable Real Estate Closings?
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
            Stop Guessing. Scale Your Real Estate Inquiries with Verified AI Infrastructure.
          </h2>
          <p className="text-base text-slate-300 font-medium max-w-2xl mx-auto">
            Join Red Rose City, Blue Square Infra, and The Khushi Ram Realtors. Get instant WhatsApp qualification, high-converting Meta CAPI ads, and direct "Connect with Expert" bookings.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#lead-form-section"
              className="w-full sm:w-auto px-8 py-4 bg-[#B22B31] hover:bg-[#902227] text-white font-extrabold text-base rounded-full shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              Get Your Custom Project Blueprint →
            </a>
            <a
              href="https://wa.me/919872669935"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-base rounded-full shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              <MessageSquare size={18} /> Chat With Our Team on WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#001D35] text-white py-12 border-t border-white/10 text-xs">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Nobogent" className="h-10 w-auto object-contain brightness-0 invert" />
            <span className="text-slate-400 font-medium">
              © {new Date().getFullYear()} Nobogent AI Inc. All rights reserved.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-slate-400 font-bold">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/privacy-policy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms-and-conditions" className="hover:text-white transition-colors">Terms</Link>
          </div>
        </div>
      </footer>

      {/* MOBILE STICKY FLOATING CTA BAR */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden flex gap-2.5 p-3 bg-white/95 backdrop-blur-md border-t border-slate-200/80 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
        <a
          href="tel:+919872669935"
          className="flex-1 py-3 text-center bg-[#003D6F] text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-2"
        >
          <Phone size={14} /> Call Now
        </a>
        <a
          href="https://wa.me/919872669935"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-3 text-center bg-[#25D366] text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-2"
        >
          <MessageSquare size={14} /> WhatsApp Us
        </a>
        <a
          href="#lead-form-section"
          className="flex-1 py-3 text-center bg-[#B22B31] text-white font-black text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
        >
          Get Audit →
        </a>
      </div>
    </div>
  )
}
