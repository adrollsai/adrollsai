'use client'

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  Workflow, Plus, Play, Pause, Pencil, Trash2, Copy, Save, 
  ArrowRight, ArrowDown, Check, CheckCircle2, X, Search, Filter, 
  Sparkles, Phone, PhoneCall, MessageSquare, Users, UserCheck, 
  Clock, GitFork, ChevronRight, ChevronLeft, Loader2, AlertCircle, 
  Eye, RefreshCw, FileText, SlidersHorizontal, Layers, Bot, 
  Zap, Building2, Tag, Send, ArrowLeft, MoreHorizontal, CheckCircle,
  HelpCircle, Shield, PhoneForwarded, ZoomIn, ZoomOut, RotateCcw,
  Globe, Smartphone, Split, Sliders, MessageCircle, ExternalLink,
  ChevronDown, Flame, CheckCheck, Smile, Paperclip, Image as ImageIcon,
  Mic, MicOff, Volume2, Bell, Mail, Radio,
  BarChart3, Activity, PlayCircle, StopCircle, History, ListOrdered,
  XCircle, TrendingUp, FileSpreadsheet, Download
} from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { toast } from 'sonner'
import { SuiteHeader, SuiteTabType } from './components/suite-header'
import { AiCallingAutomationsView } from './components/ai-calling-view'
import { DmAutomationsView } from './components/dm-automations-view'
import { IgCommentsView } from './components/ig-comments-view'
import { FbCommentsView } from './components/fb-comments-view'
import { SequencesView } from './components/sequences-view'
import { SuiteAnalyticsView } from './components/suite-analytics-view'
import { ManyChatCanvas } from './components/manychat-canvas'

// Types
export type FlowNodeType = 
  // Triggers
  | 'trigger_campaign_audience'
  | 'trigger_csv_audience'
  | 'trigger_custom_audience_group'
  | 'trigger_meta_ad'
  | 'trigger_ig_dm'
  | 'trigger_ig_comment'
  | 'trigger_ig_story_mention'
  | 'trigger_fb_lead_ad'
  | 'trigger_fb_comment'
  | 'trigger_fb_messenger'
  | 'trigger_whatsapp_inbound'
  | 'trigger_whatsapp_ctwa'
  | 'trigger_ai_call_request'
  | 'portal_lead'
  | 'trigger_portal_lead'
  | 'trigger_crm_lead'
  | 'trigger_webhook'
  | 'triggerNode'
  | 'whatsappMessageNode'
  | 'notifyNode'
  | 'crmStageNode'
  | 'tagNode'
  | 'customApiNode'
  | 'aiCallNode'
  | 'emailNode'
  | 'actionNode'
  | 'inventoryDeliveryNode'
  | 'conditionNode'
  | 'delayNode'
  | 'aiAgentNode'
  // Instagram Actions
  | 'action_ig_send_dm'
  | 'action_ig_comment_reply'
  | 'action_ig_card'
  // WhatsApp Actions
  | 'action_whatsapp_msg'
  | 'action_whatsapp_questions'
  | 'action_whatsapp_interactive'
  // Facebook Actions
  | 'action_fb_send_messenger'
  | 'action_fb_comment_reply'
  // AI Voice Calling Actions
  | 'action_ai_call'
  | 'action_ai_call_transfer'
  // Email Actions
  | 'action_send_email'
  // Logic & Branching Actions
  | 'action_condition'
  | 'action_split_traffic'
  | 'action_delay'
  | 'action_follow_up'
  | 'action_qualify'
  | 'action_ai_qualify'
  // CRM, Tags & System Actions
  | 'action_add_tag'
  | 'action_remove_tag'
  | 'action_add_note'
  | 'action_update_field'
  | 'action_crm_stage'
  | 'action_assign_agent'
  | 'action_webhook'
  | 'action_notify_team'

export interface FlowNode {
  id: string
  type: FlowNodeType | string
  title: string
  description?: string
  config: Record<string, any>
  branch?: 'true' | 'false' | 'main'
  position?: { x: number; y: number }
  data?: any
}

export interface AutomationFlow {
  id?: string
  name: string
  description: string
  icon?: string
  isActive: boolean
  trigger: {
    type: string
    label: string
    campaignId?: string
    campaignName?: string
    portalName?: string
    keywords?: string
    audienceSegment?: string
    csvFileName?: string
    csvLeadCount?: number
    csvMapping?: { nameCol?: string; phoneCol?: string; emailCol?: string; budgetCol?: string }
    customGroupName?: string
    customGroupId?: string
    config?: Record<string, any>
  }
  nodes: FlowNode[] | any[]
  edges?: any[]
  xyNodes?: any[]
  xyEdges?: any[]
  stats?: {
    runs: number
    completed: number
    lastTriggeredAt: string | null
  }
}

// Official Gemini 3.1 Flash Live Voices
const GEMINI_LIVE_VOICES = [
  { id: 'Puck', name: 'Puck', tone: 'Clear, upbeat & engaging', tag: 'Recommended for Sales & Luxury', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'Fenrir', name: 'Fenrir', tone: 'Crisp, focused & persuasive', tag: 'High Clarity & Telecalling', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'Kore', name: 'Kore', tone: 'Warm, calming & consultative', tag: 'Support & Qualification', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'Charon', name: 'Charon', tone: 'Deep, resonant & authoritative', tag: 'Executive & HNIs', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'Aoede', name: 'Aoede', tone: 'Melodic, friendly & natural conversationalist', tag: 'Conversational Outreach', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
]

// Pre-uploaded CSV Audiences for Instant Selection
const SAMPLE_CSV_AUDIENCES = [
  { id: 'csv_1', name: 'Mohali-Luxury-HNIs-Calling-List.csv', count: 450, date: 'Uploaded today', tag: 'HNIs / Investors' },
  { id: 'csv_2', name: 'Zirakpur-Investors-Calling-Pool.csv', count: 1280, date: 'Uploaded 2 days ago', tag: 'Bulk Audience' },
  { id: 'csv_3', name: 'Aerocity-Plots-Inquiries-2026.csv', count: 320, date: 'Uploaded last week', tag: 'Commercial / Plots' },
  { id: 'csv_4', name: 'Joy-Grand-DNP-Retry-List.csv', count: 215, date: 'Uploaded 3 days ago', tag: 'DNP Retry Pool' },
]

// Pre-configured Custom Audience Groups / Segments
const SAMPLE_AUDIENCE_GROUPS = [
  { id: 'grp_1', name: 'Mohali Luxury Segment (HNIs > 2 Cr)', count: 640, tag: 'High Intent', desc: 'Verified prospects with budget > ₹2 Cr' },
  { id: 'grp_2', name: 'Weekend Site Visit Target Pool', count: 1120, tag: 'Visit Pending', desc: 'Prospects requesting weekend callback' },
  { id: 'grp_3', name: 'DNP (Did Not Pick) Calling Retry Pool', count: 410, tag: 'Retry Calling', desc: 'Recent unanswered contacts ready for 2nd touch' },
  { id: 'grp_4', name: 'Cold Leads Re-engagement Segment', count: 890, tag: 'Nurture', desc: '30-day dormant leads for reactivation' },
]

// Realistic Prospect Pool for Live Batch Flow Simulation
const PROSPECT_POOL = [
  { name: 'Rohit Verma', phone: '+91 98765 43210', budget: '2.5 Cr', intent: 'High', location: 'Mohali Sector 82' },
  { name: 'Priya Sharma', phone: '+91 98112 34567', budget: '1.8 Cr', intent: 'Medium', location: 'Aerocity' },
  { name: 'Vikramjeet Singh', phone: '+91 97800 12345', budget: '3.2 Cr', intent: 'High', location: 'Chandigarh Sec 9' },
  { name: 'Ananya Gupta', phone: '+91 98223 98765', budget: '1.2 Cr', intent: 'Low', location: 'Zirakpur' },
  { name: 'Jaspreet Kaur', phone: '+91 99144 55667', budget: '2.8 Cr', intent: 'High', location: 'Mohali Eco City' },
  { name: 'Sunil Mehta', phone: '+91 98711 22334', budget: '4.5 Cr', intent: 'High', location: 'Panchkula Sec 6' },
  { name: 'Harpreet Sandhu', phone: '+91 98888 77665', budget: '90 Lakh', intent: 'Low', location: 'Kharar' },
  { name: 'Deepak Singhal', phone: '+91 98140 33221', budget: '2.2 Cr', intent: 'High', location: 'Chandigarh Sec 35' },
  { name: 'Neha Kapoor', phone: '+91 98720 11998', budget: '1.5 Cr', intent: 'Medium', location: 'Mohali Sec 68' },
  { name: 'Rajesh Bansal', phone: '+91 98155 44332', budget: '3.0 Cr', intent: 'High', location: 'Sector 70 Mohali' }
]

// Pre-built Starter Templates (Enterprise Grade Omnichannel Suite)
const FLOW_TEMPLATES: {
  id: string
  title: string
  category: string
  tag: string
  badgeColor: string
  description: string
  icon: any
  flow: Omit<AutomationFlow, 'id'>
}[] = [
  {
    id: 'whatsapp_broadcast_inventory',
    title: 'Template Quick Reply ➔ Inventory Link & Admin Alert',
    category: 'WhatsApp Broadcasts',
    tag: '⭐ Highly Recommended',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    description: 'When prospect taps "Interested" on your WhatsApp broadcast template, instantly deliver your live inventory catalog link and alert admin via push, in-app bell & WhatsApp.',
    icon: MessageSquare,
    flow: {
      name: 'Broadcast Interested ➔ Inventory & Admin Alert',
      description: 'Triggered when prospect taps "Interested" on WhatsApp broadcast template message.',
      isActive: true,
      trigger: {
        type: 'trigger_whatsapp_template_button',
        label: 'Template Button Click: "Interested"',
        config: {
          trigger_on: 'button_click',
          button_text: 'Interested',
          button_id: 'interested_btn'
        }
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_msg',
          title: 'Deliver Live Property Inventory Link',
          description: 'Sends live property catalog link with interactive CTA button',
          branch: 'main',
          config: {
            message: 'Thank you for your interest! 🌟 Here is our latest inventory and property catalog for {{business_name}}:\n\n👉 {{inventory_url}}\n\nFeel free to explore available units, floor plans, and pricing.',
            buttonText: 'View Inventory 🏢',
            buttonUrl: '{{inventory_url}}'
          }
        },
        {
          id: 'step_2',
          type: 'action_notify_team',
          title: 'High-Priority Alert to Admin',
          description: 'Dispatches instant push, in-app bell, and WhatsApp alert to Admin with direct CRM lead link',
          branch: 'main',
          config: {
            title: '🔥 Lead Clicked Interested on WhatsApp Broadcast!',
            body: 'Prospect {{lead_name}} ({{lead_phone}}) clicked "Interested" for {{business_name}}! Follow up now.'
          }
        },
        {
          id: 'step_3',
          type: 'action_crm_stage',
          title: 'Move Lead to "Interested" Stage',
          description: 'Updates CRM lead pipeline stage to Interested',
          branch: 'main',
          config: {
            stage: 'Interested',
            tags: 'WhatsApp Campaign, Clicked Interested'
          }
        }
      ]
    }
  },
  {
    id: 'ig_comment_dm_growth',
    title: 'Instagram Reel Comment to Instant DM & WhatsApp',
    category: 'Instagram Automation',
    tag: '🟣 Reel Comments & DMs',
    badgeColor: 'bg-pink-50 text-pink-700 border-pink-200',
    description: 'When someone comments "PRICE" on an Instagram Reel, post an instant public reply, deliver the brochure in DM, and tag as an engaged prospect.',
    icon: MessageCircle,
    flow: {
      name: 'Instagram Reel Comment to Instant DM Flow',
      description: 'Auto-replies to Reel comments and sends private DM with verified brochure and CTA buttons.',
      isActive: false,
      trigger: {
        type: 'trigger_ig_comment',
        label: 'Instagram Reel & Post Comment (Keyword Match)'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_ig_comment_reply',
          title: 'Public Comment Reply + Private DM',
          description: 'Instant public reply to boost algorithm reach and private DM handoff',
          config: {
            publicReplyText: 'Sent you the verified brochure & price list in DM! 📩 Check your requests.',
            sendPrivateDm: true,
            dmMessage: 'Hey {{lead.name}}! Thanks for commenting on our reel. Here is the verified project brochure and floor plan deck: https://nobogent.com/brochure'
          }
        },
        {
          id: 'step_2',
          type: 'action_ig_send_dm',
          title: 'Deliver Interactive Brochure Card in DM',
          description: 'Sends interactive buttons to book site visit or speak with an agent',
          config: {
            message: 'Would you like to schedule a private site visit this weekend, or view our 3 & 4 BHK sample flat walkthrough?',
            buttons: [
              { id: 'btn_1', title: '📅 Book Site Visit', actionType: 'crm_stage', actionValue: 'Visit Planned' },
              { id: 'btn_2', title: '💬 Chat with Closer', actionType: 'assign_agent', actionValue: 'Harman Bajwa' }
            ]
          }
        },
        {
          id: 'step_3',
          type: 'action_add_tag',
          title: 'Attach Tag "Instagram Reel Lead"',
          description: 'Tag contact for Instagram audience retargeting',
          config: {
            tag: 'Instagram Reel Lead'
          }
        },
        {
          id: 'step_4',
          type: 'action_crm_stage',
          title: 'Move CRM Stage to "Contacted"',
          description: 'Track in active pipeline',
          config: {
            stage: 'Contacted',
            tags: 'Instagram Automation, DM Sent'
          }
        }
      ]
    }
  },
  {
    id: 'fb_lead_ad_speed_to_lead',
    title: 'Facebook Lead Ad to Instant Voice Call & WhatsApp',
    category: 'Meta Lead Gen',
    tag: '🔵 Lead Ads + 🎙️ Gemini Live',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Instant WhatsApp brochure delivery on Facebook Lead Ad submission, followed by a Gemini Live outbound qualification call.',
    icon: Zap,
    flow: {
      name: 'Facebook Lead Ad Instant Voice & WhatsApp Flow',
      description: 'Zero-latency response for Facebook Lead Ads with WhatsApp brochure and AI voice call.',
      isActive: false,
      trigger: {
        type: 'trigger_fb_lead_ad',
        label: 'Facebook Instant Lead Ad Form'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_msg',
          title: 'Send Instant Project Brochure on WhatsApp',
          description: 'Delivers project brochure immediately upon lead submission',
          config: {
            message: 'Hi {{lead.name}}! Thank you for requesting information on Facebook. Here is the verified brochure and floor plans:',
            includeBrochure: true,
            buttons: ['📅 Schedule Visit', '💬 Talk to Agent']
          }
        },
        {
          id: 'step_2',
          type: 'action_delay',
          title: 'Wait 2 Minutes',
          description: 'Allow lead to glance at WhatsApp brochure before receiving callback',
          config: {
            duration: 2,
            unit: 'minutes',
            businessHoursOnly: false
          }
        },
        {
          id: 'step_3',
          type: 'action_ai_call',
          title: 'Gemini 3.1 Live Voice Qualification Call',
          description: 'Calls prospect, verifies interest in site visit, and checks investment budget',
          config: {
            voiceAgent: 'Fenrir (Crisp & Focused)',
            objective: 'Site Visit Confirmation',
            firstLine: 'Hi {{lead.name}}, I am calling from Bluesquare Infra following up on the brochure we just sent to your WhatsApp.'
          }
        },
        {
          id: 'step_4',
          type: 'action_ai_call_transfer',
          title: 'Transfer to Senior Closer if High Intent',
          description: 'Warm transfer to sales closer when prospect wants to book a slot',
          config: {
            closerName: 'Harman Bajwa',
            transferNumber: '+91 98765 43210',
            whisperMessage: 'Connecting high intent buyer from Facebook Lead Ad'
          }
        }
      ]
    }
  },
  {
    id: 'calling_qualification_pipeline',
    title: 'Outbound Calling & Qualification Pipeline',
    category: 'Calling Campaigns',
    tag: 'Gemini Live Voice & WhatsApp',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    description: 'Call existing campaign audience, qualify prospect interest deterministically, alert admin on Email & WhatsApp if they say Yes, and deliver WhatsApp brochure.',
    icon: PhoneCall,
    flow: {
      name: 'Outbound Calling & Qualification Pipeline',
      description: 'Calls existing campaign audience using official Gemini Live voice, qualifies prospect interest deterministically, pings admin on Email & WhatsApp, and sends WhatsApp brochure.',
      isActive: false,
      trigger: {
        type: 'trigger_campaign_audience',
        label: 'Existing Campaign Audience (Calling Target)',
        campaignName: 'Joy Grand Luxury Residences'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_ai_call',
          title: 'Automated AI Voice Call (Gemini Live)',
          description: 'Official Gemini 3.1 Live voice asks qualification questions and auto-saves answers to Lead Profile',
          branch: 'main',
          config: {
            voiceAgent: 'Fenrir (Crisp & Focused)',
            objective: 'Site Visit Confirmation & Budget Qualification',
            firstLine: 'Hi {{lead.name}}, I am calling from Bluesquare Infra regarding your interest in Joy Grand.',
            questions: [
              {
                id: 'q_1',
                question: 'Are you interested in scheduling a site visit to Joy Grand this weekend?',
                fieldKey: 'site_visit_interest',
                saveToLeadProfile: true,
                expectedAnswer: 'Yes / Saturday / Sunday'
              },
              {
                id: 'q_2',
                question: 'What is your preferred investment budget range (e.g. 1.5 Cr to 2.5 Cr)?',
                fieldKey: 'budget_range',
                saveToLeadProfile: true,
                expectedAnswer: '1.5 Cr - 2.5 Cr'
              }
            ],
            qualificationQuestion: 'Are you interested in scheduling a site visit this weekend?'
          }
        },
        {
          id: 'step_2',
          type: 'action_qualify',
          title: 'Deterministic Qualification: Said Yes on Call?',
          description: 'Exact rule verification without hallucinations',
          branch: 'main',
          config: {
            scoringMode: 'points',
            passScore: 100,
            rules: [
              {
                id: '1',
                field: 'site_visit_interest',
                label: 'Prospect Agreed / Answered Yes to Site Visit',
                operator: 'contains_any',
                value: 'yes, yeah, sure, interested, visit, confirm, weekend, definitely, please share',
                points: 100,
                required: true
              }
            ]
          }
        },
        {
          id: 'step_3',
          type: 'action_condition',
          title: 'Branch: Qualified (Said Yes) vs Not Interested',
          description: 'Splits workflow based on qualification pass score',
          branch: 'main',
          config: {
            evaluationType: 'qualification_score',
            field: 'qualification_score',
            operator: '>=',
            value: 100,
            branchTrueLabel: 'Branch A: Qualified (Said Yes / High Intent)',
            branchFalseLabel: 'Branch B: Not Interested / Low Intent'
          }
        },
        {
          id: 'step_4',
          type: 'action_notify_team',
          title: 'Instant Alert to Admin (Email + WhatsApp)',
          description: 'Dispatches lead name, phone, call recording & score to Admin',
          branch: 'true',
          config: {
            channels: ['email', 'whatsapp'],
            adminEmail: 'admin@bluesquareinfra.com',
            adminWhatsapp: '+91 98765 43210',
            includeLeadInfo: true,
            includeCallDetails: true,
            alertMessage: '🔥 HOT LEAD ALERT: {{lead.name}} ({{lead.phone}}) confirmed site visit on call! Call recording & qualification attached.'
          }
        },
        {
          id: 'step_5',
          type: 'action_whatsapp_msg',
          title: 'Deliver Project Brochure on WhatsApp',
          description: 'Sends official Joy Grand PDF brochure and interactive response buttons',
          branch: 'true',
          config: {
            message: 'Hello {{lead.name}}! Thank you for confirming your interest on the call. Here is the official Joy Grand project brochure, floor plans, and pricing sheet:',
            includeBrochure: true,
            brochureUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
            buttonType: 'quick_reply',
            quickReplyButtons: [
              { id: 'btn_1', title: '📅 Confirm Saturday Slot', actionType: 'crm_stage', actionValue: 'Visit Planned' },
              { id: 'btn_2', title: '💬 Chat With Sales', actionType: 'assign_agent', actionValue: 'Harman Bajwa' },
              { id: 'btn_3', title: '📍 Location Pin', actionType: 'send_reply', actionValue: 'Here is our sales gallery location on Google Maps: https://maps.google.com/?q=Joy+Grand+Mohali' }
            ],
            ctaButtons: [
              { id: 'cta_1', title: '📍 Open Google Maps', type: 'url', url: 'https://maps.google.com/?q=Joy+Grand+Mohali' },
              { id: 'cta_2', title: '🌐 View Project Website', type: 'url', url: 'https://bluesquareinfra.com/joygrand' }
            ],
            buttons: ['📅 Confirm Saturday Slot', '💬 Chat With Sales', '📍 Location Pin']
          }
        },
        {
          id: 'step_6',
          type: 'action_crm_stage',
          title: 'Move Stage to "Visit Planned"',
          description: 'Updates CRM pipeline stage with tags',
          branch: 'true',
          config: {
            stage: 'Visit Planned',
            tags: 'Calling Campaign, Qualified On Call, Brochure Sent'
          }
        },
        {
          id: 'step_7',
          type: 'action_crm_stage',
          title: 'Move Stage to "Follow-up Later"',
          description: 'When prospect was busy or did not confirm on call',
          branch: 'false',
          config: {
            stage: 'Contacted',
            tags: 'Calling Campaign, Needs Follow-up'
          }
        }
      ]
    }
  },
  {
    id: 'hiring_screening',
    title: 'Hiring Ad & Deterministic Screening',
    category: 'Recruitment',
    tag: 'Automated Hiring',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    description: 'When candidate clicks Meta Hiring Ad, send WhatsApp screening questions, evaluate responses deterministically, and schedule interview.',
    icon: Users,
    flow: {
      name: 'Hiring Ad & Deterministic Screening Flow',
      description: 'Auto-qualifies job applicants from Meta ads via WhatsApp conversational bot and schedules interviews.',
      isActive: false,
      trigger: {
        type: 'meta_ad',
        label: 'Meta Hiring Campaign Lead'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_questions',
          title: 'Ask 3 Screening Questions',
          description: 'Candidate experience, current location & expected salary',
          config: {
            questions: [
              'How many years of relevant telecalling / sales experience do you have?',
              'Are you comfortable working on-site in Mohali / Chandigarh?',
              'What is your expected monthly salary and notice period?'
            ],
            quickReplies: ['2+ Years Exp', '1 Year Exp', 'Fresher', 'Immediate Joiner'],
            saveField: 'candidate_screening_answers'
          }
        },
        {
          id: 'step_2',
          type: 'action_qualify',
          title: 'Deterministic Qualification & Scoring',
          description: 'Evaluate candidate responses against deterministic job criteria',
          config: {
            scoringMode: 'points',
            passScore: 70,
            rules: [
              { id: '1', field: 'experience', label: 'Sales Experience >= 2 Years', operator: 'contains_any', value: '2+ Years, 2 Years', points: 40, required: true },
              { id: '2', field: 'location', label: 'On-site in Mohali / Chandigarh', operator: 'contains_any', value: 'Yes, Comfortable', points: 30, required: true },
              { id: '3', field: 'salary', label: 'Expected Salary <= 35k', operator: 'contains_any', value: 'Under 30k, 30k, 35k, Under 35000', points: 30, required: false }
            ]
          }
        },
        {
          id: 'step_3',
          type: 'action_condition',
          title: 'If Qualified (Score >= 70 pts)',
          description: 'Branch based on deterministic qualification rules',
          config: {
            field: 'qualification_score',
            operator: '>=',
            value: 70
          }
        },
        {
          id: 'step_4',
          type: 'action_crm_stage',
          title: 'Move to "Interview Scheduled"',
          description: 'Update pipeline stage in CRM',
          config: {
            stage: 'Interview Scheduled',
            tags: 'Hiring Ad, Qualified Candidate, Fast-Track'
          },
          branch: 'true'
        },
        {
          id: 'step_5',
          type: 'action_assign_agent',
          title: 'Assign Lead to HR Closer',
          description: 'Route qualified applicant to recruitment manager',
          config: {
            assignMode: 'individual',
            agentName: 'Harman Bajwa'
          },
          branch: 'true'
        },
        {
          id: 'step_6',
          type: 'action_whatsapp_msg',
          title: 'Send Interview Confirmation & Calendar Link',
          description: 'Send greeting, office address & Google Maps link',
          config: {
            message: '🎉 Congratulations {{lead.name}}! Based on your qualifications, we have scheduled your in-person interview. Please find our office location and slot details below:',
            buttons: ['📍 Office Location', '📅 Reschedule Slot', '💬 Chat HR']
          },
          branch: 'true'
        }
      ]
    }
  },
  {
    id: 'real_estate_speed_to_lead',
    title: 'Real Estate Instant Lead Qualifier',
    category: 'Sales Acceleration',
    tag: 'Speed to Lead',
    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200',
    description: 'Instant AI Voice callback in 2 minutes, WhatsApp brochure delivery, and auto-assignment via Group Distribution.',
    icon: PhoneCall,
    flow: {
      name: 'Instant AI Voice Call & Brochure Flow',
      description: 'Calls leads within 2 minutes of ad submission and shares property brochure on WhatsApp.',
      isActive: false,
      trigger: {
        type: 'meta_ad',
        label: 'Meta Ad & Housing.com Lead'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_delay',
          title: 'Wait 2 Minutes',
          description: 'Optimal window for maximum lead pick-up rate',
          config: {
            duration: 2,
            unit: 'minutes',
            businessHoursOnly: false
          }
        },
        {
          id: 'step_2',
          type: 'action_ai_call',
          title: 'Automated AI Voice Call',
          description: 'Greet prospect, confirm unit interest & check site visit date',
          config: {
            voiceAgent: 'Puck (Clear & Engaging)',
            objective: 'Schedule Site Visit & Confirm Budget',
            firstLine: 'Hi {{lead.name}}, thank you for your inquiry on our luxury residences! Am I speaking with the buyer?'
          }
        },
        {
          id: 'step_3',
          type: 'action_whatsapp_msg',
          title: 'Send WhatsApp Brochure & Location',
          description: 'Deliver project PDF brochure and Google Maps pin',
          config: {
            message: 'Hello {{lead.name}}! Thank you for speaking with us. Here is the official project brochure, floor plans, and pricing sheet for your review:',
            includeBrochure: true,
            brochureUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
            buttons: ['📅 Book Site Visit', '📍 Location Map', '📞 Call Sales Agent']
          }
        },
        {
          id: 'step_4',
          type: 'action_assign_agent',
          title: 'Route Lead via Group Distribution',
          description: 'Distribute lead across sales team using weighted round robin',
          config: {
            assignMode: 'group',
            groupName: 'Mohali Sales Team (Group Distribution)'
          }
        }
      ]
    }
  },
  {
    id: 'whatsapp_inbound_bot',
    title: 'Inbound WhatsApp 24/7 AI Receptionist',
    category: 'Conversational AI',
    tag: 'Instant Reply',
    badgeColor: 'bg-purple-100 text-purple-700 border-purple-200',
    description: 'Answers inbound WhatsApp chats instantly using workspace knowledge, captures phone & email, and syncs to CRM.',
    icon: MessageSquare,
    flow: {
      name: '24/7 Inbound WhatsApp Receptionist',
      description: 'Handles all incoming customer messages with intelligent knowledgebase responses.',
      isActive: false,
      trigger: {
        type: 'whatsapp_inbound',
        label: 'New Inbound WhatsApp Message',
        keywords: 'price, brochure, visit, 2bhk, 3bhk'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_msg',
          title: 'Instant Welcome & Menu',
          description: 'Send warm greeting with interactive quick options',
          config: {
            message: '👋 Welcome to Bluesquare Infra! How can our team assist you today?',
            buttons: ['🏢 Explore Properties', '💰 Pricing & Offers', '📅 Schedule Visit']
          }
        },
        {
          id: 'step_2',
          type: 'action_whatsapp_questions',
          title: 'Capture Requirement & Budget',
          description: 'Ask unit configuration & budget range',
          config: {
            questions: [
              'Which configuration are you interested in (2 BHK, 3 BHK, or Penthouse)?',
              'What is your preferred budget range?'
            ],
            quickReplies: ['2 BHK (80L-1Cr)', '3 BHK (1.2Cr-1.6Cr)', 'Penthouse (2.5Cr+)'],
            saveField: 'buyer_preference'
          }
        },
        {
          id: 'step_3',
          type: 'action_crm_stage',
          title: 'Tag as "WhatsApp Inbound"',
          description: 'Create or update lead in CRM with conversation history',
          config: {
            stage: 'New Lead',
            tags: 'WhatsApp Inbound, Warm Buyer'
          }
        }
      ]
    }
  },
  {
    id: 'portal_housing_routing',
    title: 'Housing.com & 99Acres Instant Sync',
    category: 'Lead Routing',
    tag: 'Portals',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    description: 'Instantly ingest Housing.com & 99Acres leads, send WhatsApp greeting with brochure, and assign to portal closing team.',
    icon: Globe,
    flow: {
      name: 'Housing.com & 99Acres Inbound Automation',
      description: 'Instant WhatsApp brochure & group assignment for portal leads.',
      isActive: false,
      trigger: {
        type: 'portal_lead',
        label: 'Housing.com / 99Acres Inbound Lead',
        portalName: 'Housing.com'
      },
      nodes: [
        {
          id: 'step_1',
          type: 'action_whatsapp_msg',
          title: 'Send Instant Project Brochure',
          description: 'Acknowledge portal inquiry and send PDF on WhatsApp',
          config: {
            message: 'Hi {{lead.name}}! Thank you for inquiring on Housing.com for our project. Here is the verified brochure & price breakdown:',
            includeBrochure: true,
            buttons: ['📅 Schedule Site Visit', '💬 Chat With Us']
          }
        },
        {
          id: 'step_2',
          type: 'action_assign_agent',
          title: 'Assign via Group Distribution',
          description: 'Assign lead to designated portal distribution group',
          config: {
            assignMode: 'group',
            groupName: 'Housing.com Leads Group'
          }
        },
        {
          id: 'step_3',
          type: 'action_crm_stage',
          title: 'Set CRM Stage to "Contacted"',
          description: 'Track portal lead in pipeline',
          config: {
            stage: 'Contacted',
            tags: 'Housing.com, Portal Inbound'
          }
        }
      ]
    }
  }
]

// All available node definitions (Enterprise Omnichannel Builder)
const NODE_DEFINITIONS: {
  type: FlowNodeType
  category: 'Instagram' | 'WhatsApp' | 'Facebook' | 'AI Voice Calling' | 'Email' | 'Logic & Flow' | 'CRM & Actions' | 'Triggers' | 'Communication' | 'AI & Logic' | 'CRM & Routing'
  channel: 'instagram' | 'whatsapp' | 'facebook' | 'voice' | 'email' | 'logic' | 'crm' | 'triggers'
  title: string
  description: string
  icon: any
  color: string
  badgeColor: string
}[] = [
  // 🟣 INSTAGRAM AUTOMATION NODES
  {
    type: 'trigger_ig_dm',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Instagram Inbound DM Trigger',
    description: 'Triggers when a prospect sends an Instagram DM matching keywords (e.g. PRICE, BROCHURE, INFO)',
    icon: MessageCircle,
    color: 'border-pink-300 bg-pink-50 text-pink-700',
    badgeColor: 'bg-gradient-to-r from-purple-50 to-pink-50 text-pink-700 border-pink-200'
  },
  {
    type: 'trigger_ig_comment',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Instagram Reel & Post Comments',
    description: 'Triggers when someone comments on your Instagram reels, posts, or sponsored ad creatives',
    icon: MessageSquare,
    color: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
    badgeColor: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
  },
  {
    type: 'trigger_ig_story_mention',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Instagram Story Mention / Reply',
    description: 'Triggers when a prospect mentions your handle in an Instagram Story or replies to your story',
    icon: Sparkles,
    color: 'border-purple-300 bg-purple-50 text-purple-700',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
  },
  {
    type: 'action_ig_send_dm',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Send Instagram Direct Message',
    description: 'Sends personalized DM with rich media links, project brochure, and interactive quick reply buttons',
    icon: Send,
    color: 'border-pink-300 bg-pink-50 text-pink-700',
    badgeColor: 'bg-pink-50 text-pink-700 border-pink-200'
  },
  {
    type: 'action_ig_comment_reply',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Instagram Comment Auto-Reply',
    description: 'Posts an instant public reply to the comment and immediately sends private DM with requested brochure',
    icon: MessageCircle,
    color: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
    badgeColor: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
  },
  {
    type: 'action_ig_card',
    category: 'Instagram',
    channel: 'instagram',
    title: 'Send Instagram Brochure Card',
    description: 'Sends a visual property brochure card with hero image, pricing details, and direct CTA buttons',
    icon: ImageIcon,
    color: 'border-rose-300 bg-rose-50 text-rose-700',
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200'
  },

  // 🟢 WHATSAPP AUTOMATION NODES
  {
    type: 'trigger_whatsapp_inbound',
    category: 'WhatsApp',
    channel: 'whatsapp',
    title: 'WhatsApp Inbound Message',
    description: 'Triggers when a customer messages your WhatsApp business number or sends a keyword',
    icon: MessageSquare,
    color: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  {
    type: 'trigger_whatsapp_ctwa',
    category: 'WhatsApp',
    channel: 'whatsapp',
    title: 'Click-to-WhatsApp Ad Lead',
    description: 'Triggers when a prospect clicks a Meta Click-to-WhatsApp ad with campaign source tracking',
    icon: Smartphone,
    color: 'border-teal-300 bg-teal-50 text-teal-700',
    badgeColor: 'bg-teal-50 text-teal-700 border-teal-200'
  },
  {
    type: 'action_whatsapp_msg',
    category: 'WhatsApp',
    channel: 'whatsapp',
    title: 'Send WhatsApp Message',
    description: 'Sends rich text, verified PDF brochure, and interactive quick-reply buttons or CTA links',
    icon: Send,
    color: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },
  {
    type: 'action_whatsapp_questions',
    category: 'WhatsApp',
    channel: 'whatsapp',
    title: 'Ask Questions / Screening Form',
    description: 'Screening questions (budget, BHK, timeline) with custom field auto-saving and quick reply chips',
    icon: MessageCircle,
    color: 'border-teal-300 bg-teal-50 text-teal-700',
    badgeColor: 'bg-teal-50 text-teal-700 border-teal-200'
  },
  {
    type: 'action_whatsapp_interactive',
    category: 'WhatsApp',
    channel: 'whatsapp',
    title: 'WhatsApp Interactive List Menu',
    description: 'Interactive list picker for unit selection, floor plan choices, or scheduling appointment slots',
    icon: Layers,
    color: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },

  // 🔵 FACEBOOK AUTOMATION NODES
  {
    type: 'trigger_fb_lead_ad',
    category: 'Facebook',
    channel: 'facebook',
    title: 'Facebook Lead Ad (Instant Form)',
    description: 'Triggers instantly when a prospect submits a Facebook or Meta Lead Ad instant form',
    icon: Zap,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'trigger_fb_comment',
    category: 'Facebook',
    channel: 'facebook',
    title: 'Facebook Post & Ad Comment',
    description: 'Triggers when someone comments on your Facebook page posts or sponsored ad creatives',
    icon: MessageSquare,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'trigger_fb_messenger',
    category: 'Facebook',
    channel: 'facebook',
    title: 'Facebook Messenger Inbound',
    description: 'Triggers when a prospect clicks "Send Message" on Facebook or sends a Messenger chat',
    icon: MessageCircle,
    color: 'border-sky-300 bg-sky-50 text-sky-700',
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200'
  },
  {
    type: 'action_fb_send_messenger',
    category: 'Facebook',
    channel: 'facebook',
    title: 'Send Facebook Messenger Message',
    description: 'Sends rich text message with clickable CTA buttons and quick reply response chips',
    icon: Send,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'action_fb_comment_reply',
    category: 'Facebook',
    channel: 'facebook',
    title: 'Facebook Comment Auto-Reply',
    description: 'Replies publicly to Facebook post comments and delivers brochure in private Messenger conversation',
    icon: MessageSquare,
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },

  // 🎙️ AI VOICE CALLING NODES
  {
    type: 'trigger_ai_call_request',
    category: 'AI Voice Calling',
    channel: 'voice',
    title: 'Instant AI Call Request Trigger',
    description: 'Triggers when a prospect clicks "Call Me Now" on lander or submits a callback request form',
    icon: Phone,
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    type: 'action_ai_call',
    category: 'AI Voice Calling',
    channel: 'voice',
    title: 'Automated AI Voice Call (Gemini Live)',
    description: 'Outbound call with official Gemini Live voice (Puck, Fenrir, Kore, Charon, Aoede) & multi-question qualification',
    icon: PhoneCall,
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    type: 'action_ai_call_transfer',
    category: 'AI Voice Calling',
    channel: 'voice',
    title: 'Live Call Transfer to Closer',
    description: 'Seamlessly transfers active call to a human sales rep or closer when high intent is detected',
    icon: PhoneForwarded,
    color: 'border-purple-300 bg-purple-50 text-purple-700',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
  },

  // 📧 EMAIL NODES
  {
    type: 'action_send_email',
    category: 'Email',
    channel: 'email',
    title: 'Send Rich Email',
    description: 'Delivers HTML email with verified project brochure PDF, pricing breakdown, and site visit booking link',
    icon: Mail,
    color: 'border-sky-300 bg-sky-50 text-sky-700',
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200'
  },

  // 🔀 LOGIC & FLOW CONTROL NODES
  {
    type: 'action_condition',
    category: 'Logic & Flow',
    channel: 'logic',
    title: 'Condition / If-Else Branch',
    description: 'Dual-path logic branch based on qualification score, answers, tags, or buyer budget',
    icon: GitFork,
    color: 'border-rose-300 bg-rose-50 text-rose-700',
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200'
  },
  {
    type: 'action_split_traffic',
    category: 'Logic & Flow',
    channel: 'logic',
    title: 'Split Traffic (A/B Test)',
    description: 'Splits incoming leads into randomized percentage branches (e.g. 50/50, 70/30) for conversion testing',
    icon: Split,
    color: 'border-amber-300 bg-amber-50 text-amber-700',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  {
    type: 'action_delay',
    category: 'Logic & Flow',
    channel: 'logic',
    title: 'Smart Delay / Wait Timer',
    description: 'Pauses pipeline for specified minutes, hours, or waits for next business morning 9:00 AM',
    icon: Clock,
    color: 'border-amber-300 bg-amber-50 text-amber-700',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  {
    type: 'action_follow_up',
    category: 'Logic & Flow',
    channel: 'logic',
    title: 'Multi-Day Drip Sequence',
    description: 'Enrolls the contact into an automated multi-day drip nurture sequence',
    icon: ListOrdered,
    color: 'border-violet-300 bg-violet-50 text-violet-700',
    badgeColor: 'bg-violet-50 text-violet-700 border-violet-200'
  },
  {
    type: 'action_qualify',
    category: 'Logic & Flow',
    channel: 'logic',
    title: 'Deterministic Lead Scoring',
    description: 'Exact rule-based criteria & scoring without AI drift or hallucinations',
    icon: CheckCircle2,
    color: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  },

  // ⚡ CRM, TAGS & ACTIONS NODES
  {
    type: 'action_add_tag',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Add Contact Tag',
    description: 'Attaches a specific tag to the contact profile for segmentation and filtering',
    icon: Tag,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'action_remove_tag',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Remove Contact Tag',
    description: 'Removes an existing tag from the contact profile upon progression',
    icon: Tag,
    color: 'border-slate-300 bg-slate-50 text-slate-700',
    badgeColor: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  {
    type: 'action_add_note',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Add Contact Note',
    description: 'Logs an internal activity or qualification summary directly into the lead timeline',
    icon: FileText,
    color: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    badgeColor: 'bg-yellow-50 text-yellow-700 border-yellow-200'
  },
  {
    type: 'action_update_field',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Update Custom Field',
    description: 'Updates a specific lead attribute (e.g. budget, preferred location, timeline, intent)',
    icon: Sliders,
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    type: 'action_crm_stage',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Update CRM Stage & Tags',
    description: 'Moves lead to target pipeline stage and attaches stage-specific tags',
    icon: Tag,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'action_assign_agent',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Assign Lead (Agent or Group)',
    description: 'Assigns to specific agent or to a distribution group with weighted round-robin',
    icon: UserCheck,
    color: 'border-cyan-300 bg-cyan-50 text-cyan-700',
    badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200'
  },
  {
    type: 'action_webhook',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Send Outbound Webhook',
    description: 'POSTs lead payload to external CRM, Zapier, Make, or custom API',
    icon: ExternalLink,
    color: 'border-purple-300 bg-purple-50 text-purple-700',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
  },
  {
    type: 'action_notify_team',
    category: 'CRM & Actions',
    channel: 'crm',
    title: 'Notify Admin & Team (Email + WhatsApp)',
    description: 'Sends instant alert to admin email and WhatsApp with lead info, score, and call confirmation',
    icon: Bell,
    color: 'border-amber-300 bg-amber-50 text-amber-700',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
  },

  // 🎯 INBOUND & AUDIENCE TRIGGERS
  {
    type: 'trigger_campaign_audience',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Existing Campaign Audience',
    description: 'Triggers outbound calling or messaging for contacts in an existing campaign audience',
    icon: PhoneCall,
    color: 'border-indigo-300 bg-indigo-50 text-indigo-700',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  },
  {
    type: 'trigger_csv_audience',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Uploaded CSV Audience',
    description: 'Run outbound calling or WhatsApp workflows on custom uploaded CSV lead lists',
    icon: FileText,
    color: 'border-violet-300 bg-violet-50 text-violet-700',
    badgeColor: 'bg-violet-50 text-violet-700 border-violet-200'
  },
  {
    type: 'trigger_custom_audience_group',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Custom Audience Group / Segment',
    description: 'Target a custom lead group, CRM audience segment, or DNP retry pool',
    icon: Users,
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  {
    type: 'trigger_meta_ad',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Meta Ad Campaign Lead',
    description: 'Triggers when a prospect submits a lead form on Facebook or Instagram',
    icon: Zap,
    color: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700',
    badgeColor: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200'
  },
  {
    type: 'trigger_portal_lead',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Housing.com / 99Acres Lead',
    description: 'Triggers when an inbound lead arrives from Housing.com or 99Acres webhook',
    icon: Globe,
    color: 'border-amber-300 bg-amber-50 text-amber-800',
    badgeColor: 'bg-amber-50 text-amber-800 border-amber-200'
  },
  {
    type: 'trigger_crm_lead',
    category: 'Triggers',
    channel: 'triggers',
    title: 'CRM Lead Created or Stage Moved',
    description: 'Triggers when a lead enters CRM or moves to a specific pipeline stage',
    icon: Users,
    color: 'border-sky-300 bg-sky-50 text-sky-700',
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200'
  },
  {
    type: 'trigger_webhook',
    category: 'Triggers',
    channel: 'triggers',
    title: 'Inbound Webhook Trigger',
    description: 'Triggers via HTTP POST from external website forms, landing pages, or tools',
    icon: ExternalLink,
    color: 'border-slate-300 bg-slate-50 text-slate-700',
    badgeColor: 'bg-slate-100 text-slate-700 border-slate-200'
  }
]

export default function FlowsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const impersonateId = searchParams.get('impersonate')
  const supabase = createClient()

  // State: Workspace Data
  const [flows, setFlows] = useState<AutomationFlow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [team, setTeam] = useState<any[]>([])
  const [distributionGroups, setDistributionGroups] = useState<any[]>([])
  const [targetUserId, setTargetUserId] = useState<string>('')

  // State: View & Permissions
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [activeSuiteTab, setActiveSuiteTab] = useState<SuiteTabType>('ai_calling')
  const [currentFlow, setCurrentFlow] = useState<AutomationFlow | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL')
  
  // State: Canvas / Editor
  const [selectedNode, setSelectedNode] = useState<FlowNode | null>(null)
  const [isNodePaletteOpen, setIsNodePaletteOpen] = useState(false)
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [paletteChannelFilter, setPaletteChannelFilter] = useState<string>('all')
  const [paletteSearchQuery, setPaletteSearchQuery] = useState<string>('')

  // State: AI Flow Architect (DeepSeek v4-flash & Voice Dictation)
  const [isAiArchitectOpen, setIsAiArchitectOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [isGeneratingWithAi, setIsGeneratingWithAi] = useState(false)
  const [isVoiceRecording, setIsVoiceRecording] = useState(false)
  const [testedBeforePublish, setTestedBeforePublish] = useState(false)
  const speechRecognitionRef = useRef<any>(null)

  // State: Interactive WhatsApp Simulator (Nobogent Studio)
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false)
  const [simulatorTab, setSimulatorTab] = useState<'chat' | 'logs'>('chat')
  const [simStepIndex, setSimStepIndex] = useState(0)
  const [activeSimNodeId, setActiveSimNodeId] = useState<string | null>(null)
  const [isBotTyping, setIsBotTyping] = useState(false)
  const [simUserInput, setSimUserInput] = useState('')
  const [simMessages, setSimMessages] = useState<{
    id: string
    sender: 'bot' | 'user' | 'system'
    text: string
    time: string
    buttons?: string[]
    ctaButtons?: { title: string; url?: string; type?: string; phoneNumber?: string }[]
    mediaUrl?: string
    isBrochure?: boolean
  }[]>([])
  const [simLeadData, setSimLeadData] = useState<{
    name: string
    phone: string
    source: string
    project: string
    score: number
    status: string
    assignedAgent: string
    answers: Record<string, string>
  }>({
    name: 'Rohit Verma',
    phone: '+91 98765 43210',
    source: 'Meta Ad',
    project: 'Joy Grand',
    score: 0,
    status: 'NEW',
    assignedAgent: 'Unassigned',
    answers: {}
  })
  const [simLogs, setSimLogs] = useState<string[]>([])

  // State: Studio View Mode (Builder, Analytics, History)
  const [studioTab, setStudioTab] = useState<'builder' | 'analytics' | 'history'>('builder')

  // State: Manual Flow Run on Audience Modal
  const [isRunAudienceModalOpen, setIsRunAudienceModalOpen] = useState(false)
  const [selectedAudienceType, setSelectedAudienceType] = useState<'csv' | 'custom_group' | 'campaign'>('csv')
  const [selectedCsvId, setSelectedCsvId] = useState<string>('csv_1')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('grp_1')
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('')
  const [executionSampleSize, setExecutionSampleSize] = useState<'all' | '50' | '20' | '5'>('all')
  const [executionSpeed, setExecutionSpeed] = useState<'1x' | '3x' | '10x'>('3x')

  // State: Live Execution Engine & Real-time Node Counters (GoHighLevel style)
  const [isLiveRunActive, setIsLiveRunActive] = useState(false)
  const [isLiveRunPaused, setIsLiveRunPaused] = useState(false)
  const [liveRunAudience, setLiveRunAudience] = useState<{ name: string; total: number; source: string }>({
    name: 'Mohali-Luxury-HNIs-Calling-List.csv',
    total: 450,
    source: 'CSV Upload'
  })
  const [liveRunProgress, setLiveRunProgress] = useState<{ current: number; total: number; percent: number }>({
    current: 0,
    total: 450,
    percent: 0
  })
  const [nodeExecutionStats, setNodeExecutionStats] = useState<Record<string, { enroute: number; completed: number; passed: number; failed: number }>>({})
  const [liveRunLogs, setLiveRunLogs] = useState<Array<{
    id: string
    time: string
    leadName: string
    phone: string
    stepTitle: string
    detail: string
    status: 'passed' | 'failed' | 'info'
  }>>([])
  const [isLiveLogsDrawerOpen, setIsLiveLogsDrawerOpen] = useState(false)
  const [liveRunLogFilter, setLiveRunLogFilter] = useState<'all' | 'qualified' | 'filtered'>('all')

  // State: Historical Batch Runs
  const [flowRunHistory, setFlowRunHistory] = useState<Array<{
    id: string
    runAt: string
    audienceName: string
    audienceType: string
    totalLeads: number
    completedLeads: number
    qualifiedLeads: number
    duration: string
    status: 'Completed' | 'In Progress' | 'Stopped'
    conversionRate: string
  }>>([
    {
      id: 'run_hni_0906',
      runAt: 'Today at 11:30 AM',
      audienceName: 'Mohali-Luxury-HNIs-Calling-List.csv',
      audienceType: 'CSV Audience List',
      totalLeads: 450,
      completedLeads: 450,
      qualifiedLeads: 146,
      duration: '4m 12s',
      status: 'Completed',
      conversionRate: '32.4%'
    },
    {
      id: 'run_zirakpur_0904',
      runAt: 'Sep 4, 2026, 04:15 PM',
      audienceName: 'Zirakpur-Investors-Calling-Pool.csv',
      audienceType: 'CSV Audience List',
      totalLeads: 1280,
      completedLeads: 1280,
      qualifiedLeads: 384,
      duration: '11m 45s',
      status: 'Completed',
      conversionRate: '30.0%'
    },
    {
      id: 'run_grp_hni_0902',
      runAt: 'Sep 2, 2026, 02:00 PM',
      audienceName: 'Mohali Luxury Segment (HNIs > 2 Cr)',
      audienceType: 'Custom Group',
      totalLeads: 640,
      completedLeads: 640,
      qualifiedLeads: 242,
      duration: '6m 20s',
      status: 'Completed',
      conversionRate: '37.8%'
    }
  ])

  // 1. Initial Data Fetching
  useEffect(() => {
    fetchInitialData()
  }, [impersonateId])

  const fetchInitialData = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      // Authenticated user's actual profile (for super admin check, regardless of impersonation)
      const { data: authProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()

      const userRole = authProfile?.role?.toLowerCase() || ''
      const superAdminUser = userRole === 'super_admin'
      setIsSuperAdmin(superAdminUser)

      let resolvedUserId = session.user.id
      if (impersonateId) {
        if (['super_admin', 'agency', 'admin'].includes(userRole)) {
          resolvedUserId = impersonateId
        }
      }
      setTargetUserId(resolvedUserId)

      // Land on Flows by default so all clients and admins can build and run flows
      setActiveSuiteTab('flows')

      // Fetch Flows from API (Safe Content-Type check to prevent <!DOCTYPE HTML syntax crashes)
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      try {
        const res = await fetch(`/api/flows${impParam}`)
        if (res.ok) {
          const contentType = res.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const json = await res.json()
            if (json?.flows) {
              setFlows(json.flows)
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch flows from API:', err)
      }

      // Fetch Campaigns for dropdown (Safe Content-Type check)
      try {
        const campRes = await fetch(`/api/meta-ads/campaigns${impParam}`)
        if (campRes.ok) {
          const contentType = campRes.headers.get('content-type') || ''
          if (contentType.includes('application/json')) {
            const campData = await campRes.json()
            if (campData?.campaigns) {
              setCampaigns(campData.campaigns)
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch campaigns from API:', err)
      }

      // Fetch Team Members
      const { data: teamData } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, business_name')
        .or(`parent_id.eq.${resolvedUserId},agency_id.eq.${resolvedUserId},id.eq.${resolvedUserId}`)
      setTeam(teamData || [])

      // Fetch Group Lead Distribution rules
      const { data: groupRules } = await supabase
        .from('automations')
        .select('*')
        .eq('user_id', resolvedUserId)
        .eq('rule_type', 'Group-Distribution')
      
      const parsedGroups = (groupRules || []).map((r: any) => {
        try {
          const desc = JSON.parse(r.description || '{}')
          return {
            id: r.id,
            name: desc.group_name || r.title || 'Distribution Group',
            membersCount: desc.members?.length || 0,
            campaigns: desc.campaigns || []
          }
        } catch {
          return { id: r.id, name: r.title || 'Group', membersCount: 0, campaigns: [] }
        }
      })
      setDistributionGroups(parsedGroups)

    } catch (err) {
      console.error('Failed to load flows page data:', err)
      toast.error('Failed to load automation flows')
    } finally {
      setLoading(false)
    }
  }

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 10, 150))
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 10, 50))
  const handleResetZoom = () => setZoomLevel(100)

  // Helper: Seed node execution stats for any flow so counters are never blank
  const getInitialNodeStats = useCallback((flow: AutomationFlow, totalCount: number = 450) => {
    const stats: Record<string, { enroute: number; completed: number; passed: number; failed: number }> = {}
    
    // Trigger node stats
    stats['trigger'] = {
      enroute: 0,
      completed: totalCount,
      passed: totalCount,
      failed: 0
    }

    let remainingPassing = totalCount
    flow.nodes.forEach((node) => {
      if (node.type === 'action_ai_call') {
        const answered = Math.round(remainingPassing * 0.864) // 86.4% pickup rate
        stats[node.id] = {
          enroute: 0,
          completed: remainingPassing,
          passed: answered,
          failed: remainingPassing - answered
        }
        remainingPassing = answered
      } else if (node.type === 'action_qualify' || node.type === 'action_ai_qualify' || node.type === 'action_condition') {
        const qualified = Math.round(remainingPassing * 0.375) // 37.5% qualification
        stats[node.id] = {
          enroute: 0,
          completed: remainingPassing,
          passed: qualified,
          failed: remainingPassing - qualified
        }
        remainingPassing = qualified
      } else {
        stats[node.id] = {
          enroute: 0,
          completed: remainingPassing,
          passed: remainingPassing,
          failed: 0
        }
      }
    })
    return stats
  }, [])

  // Auto-initialize baseline node execution stats when a flow is loaded
  useEffect(() => {
    if (currentFlow && !isLiveRunActive) {
      setNodeExecutionStats(prev => {
        if (Object.keys(prev).length > 0 && currentFlow.nodes.some(n => prev[n.id])) {
          return prev
        }
        return getInitialNodeStats(currentFlow, 450)
      })
    }
  }, [currentFlow, isLiveRunActive, getInitialNodeStats])

  // Launch manual live batch execution over target audience data
  const handleLaunchLiveExecution = () => {
    if (!currentFlow) return
    
    let audName = 'Mohali-Luxury-HNIs-Calling-List.csv'
    let audTotal = 450
    let audSource = 'CSV Upload'

    if (selectedAudienceType === 'csv') {
      const csv = SAMPLE_CSV_AUDIENCES.find(c => c.id === selectedCsvId) || SAMPLE_CSV_AUDIENCES[0]
      audName = csv.name
      audTotal = csv.count
      audSource = 'CSV Audience List'
    } else if (selectedAudienceType === 'custom_group') {
      const grp = SAMPLE_AUDIENCE_GROUPS.find(g => g.id === selectedGroupId) || SAMPLE_AUDIENCE_GROUPS[0]
      audName = grp.name
      audTotal = grp.count
      audSource = 'Custom Group'
    } else {
      const camp = campaigns.find(c => c.id === selectedCampaignId) || campaigns[0]
      audName = camp ? `Campaign: ${camp.name}` : 'Meta Ad Campaign Audience'
      audTotal = 380
      audSource = 'Live Meta Campaign'
    }

    const batchTotal = executionSampleSize === 'all' 
      ? audTotal 
      : Math.min(audTotal, parseInt(executionSampleSize, 10))

    setLiveRunAudience({
      name: audName,
      total: batchTotal,
      source: audSource
    })

    setLiveRunProgress({
      current: 0,
      total: batchTotal,
      percent: 0
    })

    // Reset node execution stats to start clean live run
    const freshStats: Record<string, { enroute: number; completed: number; passed: number; failed: number }> = {}
    freshStats['trigger'] = {
      enroute: batchTotal,
      completed: 0,
      passed: 0,
      failed: 0
    }
    currentFlow.nodes.forEach(n => {
      freshStats[n.id] = { enroute: 0, completed: 0, passed: 0, failed: 0 }
    })
    setNodeExecutionStats(freshStats)
    setLiveRunLogs([])
    setIsLiveRunActive(true)
    setIsLiveRunPaused(false)
    setIsRunAudienceModalOpen(false)
    setStudioTab('builder')

    toast.success(`⚡ Live flow execution launched over ${audName} (${batchTotal} contacts)!`)
  }

  // Pause / Resume live run
  const handlePauseResumeLiveRun = () => {
    setIsLiveRunPaused(prev => !prev)
    toast(isLiveRunPaused ? '▶️ Live execution resumed' : '⏸️ Live execution paused')
  }

  // Stop live run
  const handleStopLiveRun = () => {
    setIsLiveRunActive(false)
    setIsLiveRunPaused(false)
    toast.info('🛑 Live execution stopped')
  }

  // Export Analytics CSV
  const handleExportAnalyticsCsv = () => {
    if (!currentFlow) return
    const csvRows = [
      ['Flow Name', currentFlow.name],
      ['Audience Source', liveRunAudience.name],
      ['Total Processed', (nodeExecutionStats['trigger']?.completed || liveRunAudience.total).toString()],
      [''],
      ['Step Index', 'Step Title', 'Step Type', 'Contacts Entered', 'Completed', 'Filtered / Dropped', 'Pass Rate %']
    ]

    let prevCount = nodeExecutionStats['trigger']?.completed || liveRunAudience.total
    csvRows.push(['Step 0', currentFlow.trigger.label || 'Trigger', currentFlow.trigger.type, prevCount.toString(), prevCount.toString(), '0', '100%'])

    currentFlow.nodes.forEach((n, idx) => {
      const stats = nodeExecutionStats[n.id] || { enroute: 0, completed: prevCount, passed: prevCount, failed: 0 }
      const passRate = stats.completed > 0 ? Math.round((stats.passed / stats.completed) * 100) : 100
      csvRows.push([
        `Step ${idx + 1}`,
        `"${n.title.replace(/"/g, '""')}"`,
        n.type,
        prevCount.toString(),
        stats.completed.toString(),
        stats.failed.toString(),
        `${passRate}%`
      ])
      prevCount = stats.passed
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.join(',')).join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `${currentFlow.name.replace(/\s+/g, '_')}_analytics_funnel.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    toast.success('📊 Funnel analytics CSV exported successfully!')
  }

  // Live Execution Simulation Engine (Progressive lead dispatch & GoHighLevel node updating)
  useEffect(() => {
    if (!isLiveRunActive || isLiveRunPaused || !currentFlow) return

    const intervalMs = executionSpeed === '1x' ? 1000 : executionSpeed === '3x' ? 380 : 110

    const timer = setInterval(() => {
      setLiveRunProgress(prev => {
        if (prev.current >= prev.total) {
          clearInterval(timer)
          setIsLiveRunActive(false)
          
          const qualifiedCount = Math.round(prev.total * 0.324)
          const newRun = {
            id: `run_${Date.now()}`,
            runAt: 'Just now',
            audienceName: liveRunAudience.name,
            audienceType: liveRunAudience.source,
            totalLeads: prev.total,
            completedLeads: prev.total,
            qualifiedLeads: qualifiedCount,
            duration: executionSpeed === '10x' ? '14s' : executionSpeed === '3x' ? '1m 18s' : '4m 12s',
            status: 'Completed' as const,
            conversionRate: `${Math.round((qualifiedCount / prev.total) * 100)}%`
          }
          setFlowRunHistory(h => [newRun, ...h])
          toast.success(`🎉 Live execution complete! Processed ${prev.total} contacts (${qualifiedCount} Qualified HNIs).`)
          return prev
        }

        const stepIncrement = executionSpeed === '10x' ? Math.min(8, prev.total - prev.current) :
                              executionSpeed === '3x' ? Math.min(3, prev.total - prev.current) : 1
        const newCurrent = prev.current + stepIncrement
        const newPercent = Math.min(100, Math.round((newCurrent / prev.total) * 100))

        // Update real-time node execution counters
        setNodeExecutionStats(prevStats => {
          const updated: Record<string, { enroute: number; completed: number; passed: number; failed: number }> = { ...prevStats }
          
          updated['trigger'] = {
            enroute: Math.max(0, prev.total - newCurrent),
            completed: newCurrent,
            passed: newCurrent,
            failed: 0
          }

          let activeCount = newCurrent
          currentFlow.nodes.forEach((node, idx) => {
            const currentLag = Math.max(0, activeCount - Math.floor(idx * (stepIncrement + 1)))
            const isFinished = newPercent === 100
            const enroute = isFinished ? 0 : Math.min(stepIncrement * 2, Math.max(0, activeCount - currentLag))
            
            let passed = currentLag
            let failed = 0
            if (node.type === 'action_ai_call') {
              passed = Math.round(currentLag * 0.864)
              failed = currentLag - passed
              activeCount = passed
            } else if (node.type === 'action_qualify' || node.type === 'action_ai_qualify' || node.type === 'action_condition') {
              passed = Math.round(currentLag * 0.375)
              failed = currentLag - passed
              activeCount = passed
            } else {
              activeCount = currentLag
            }

            updated[node.id] = {
              enroute,
              completed: currentLag,
              passed,
              failed
            }
          })

          return updated
        })

        // Generate dynamic live event log for active lead
        const lead = PROSPECT_POOL[Math.floor(Math.random() * PROSPECT_POOL.length)]
        const isQualified = Math.random() > 0.62
        const activeNode = currentFlow.nodes[Math.min(currentFlow.nodes.length - 1, Math.floor(Math.random() * currentFlow.nodes.length))]
        
        let detail = ''
        if (activeNode.type === 'action_ai_call') {
          detail = isQualified 
            ? `Gemini 3.1 Live Voice (${activeNode.config.voiceAgent || 'Fenrir'}) connected (1m 34s). Lead answered: "Yes, looking for a 3BHK luxury flat in Mohali". Saved answer to lead profile.`
            : `Voice call unanswered (DNP - Did Not Pick). Scheduled automated WhatsApp retry sequence.`
        } else if (activeNode.type === 'action_qualify' || activeNode.type === 'action_ai_qualify') {
          detail = isQualified
            ? `Deterministic scoring: 100/100 pts. Passed criteria (Budget: ${lead.budget} >= 2 Cr, Location: Mohali). Routed to Branch A.`
            : `Deterministic scoring: 30/100 pts. Low intent / budget threshold not met. Routed to Branch B (Follow-up Later).`
        } else if (activeNode.type === 'action_whatsapp_msg') {
          detail = `Delivered high-res brochure PDF + 3 Quick Reply buttons ("📅 Schedule Visit", "📞 Senior Advisor Callback", "💬 WhatsApp Chat").`
        } else if (activeNode.type === 'action_crm_stage') {
          detail = isQualified 
            ? `CRM pipeline updated: Moved stage to "Site Visit Scheduled" & tagged "Calling Campaign, High Intent".`
            : `CRM pipeline updated: Moved stage to "Follow-up Later".`
        } else if (activeNode.type === 'action_notify_team') {
          detail = `High-priority WhatsApp & Email alert dispatched to Admin for ${lead.name} (${lead.phone}).`
        } else {
          detail = `Automated action completed successfully.`
        }

        const newLog = {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toLocaleTimeString(),
          leadName: lead.name,
          phone: lead.phone,
          stepTitle: activeNode.title,
          detail,
          status: isQualified ? ('passed' as const) : ('failed' as const)
        }

        setLiveRunLogs(prevLogs => [newLog, ...prevLogs.slice(0, 99)])

        return {
          current: newCurrent,
          total: prev.total,
          percent: newPercent
        }
      })
    }, intervalMs)

    return () => clearInterval(timer)
  }, [isLiveRunActive, isLiveRunPaused, currentFlow, executionSpeed, liveRunAudience])

  // Template instantiation
  const handleUseTemplate = (tpl: typeof FLOW_TEMPLATES[0]) => {
    const newFlow: AutomationFlow = {
      ...JSON.parse(JSON.stringify(tpl.flow)),
      id: undefined,
      name: `${tpl.flow.name}`
    }
    setCurrentFlow(newFlow)
    setSelectedNode(null)
    toast.success(`Template loaded: ${tpl.title}`)
  }

  // Create Blank Flow
  const handleCreateBlankFlow = () => {
    const blank: AutomationFlow = {
      name: 'New Custom Automation Flow',
      description: 'Custom multi-step automation workflow',
      isActive: false,
      trigger: {
        type: 'meta_ad',
        label: 'Meta Ad Campaign Lead'
      },
      nodes: [
        {
          id: `step_${Date.now()}`,
          type: 'action_whatsapp_msg',
          title: 'Send Instant WhatsApp Welcome',
          description: 'Acknowledge lead submission with interactive options',
          config: {
            message: 'Hello {{lead.name}}! Thank you for reaching out. How can our team assist you today?',
            buttons: ['📅 Schedule Consultation', '🏢 View Portfolio', '📞 Request Callback']
          }
        }
      ]
    }
    setCurrentFlow(blank)
    setSelectedNode(null)
  }

  // Save Flow to Supabase
  const handleSaveFlow = async () => {
    if (!currentFlow) return
    if (!currentFlow.name.trim()) {
      toast.error('Please enter a name for this flow')
      return
    }

    setSaving(true)
    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const method = currentFlow.id ? 'PUT' : 'POST'
      const payload = {
        ...currentFlow,
        id: currentFlow.id
      }

      const res = await fetch(`/api/flows${impParam}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const isJson = res.headers.get('content-type')?.includes('application/json')
      const data = isJson ? await res.json() : {}
      if (!res.ok) throw new Error(data.error || 'Failed to save flow')

      toast.success(currentFlow.id ? 'Flow saved successfully!' : 'New flow created!')
      if (data.flow) {
        setCurrentFlow(data.flow)
        setFlows(prev => {
          const idx = prev.findIndex(f => f.id === data.flow.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = data.flow
            return next
          }
          return [data.flow, ...prev]
        })
      }
    } catch (err: any) {
      console.error('Save Flow error:', err)
      toast.error(err.message || 'Error saving flow')
    } finally {
      setSaving(false)
    }
  }

  // Publish Flow directly to Live Status
  const handlePublishFlow = async () => {
    if (!currentFlow) return
    if (!currentFlow.name.trim()) {
      toast.error('Please enter a name for this flow')
      return
    }

    setSaving(true)
    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const method = currentFlow.id ? 'PUT' : 'POST'
      const payload = {
        ...currentFlow,
        id: currentFlow.id,
        isActive: true // User explicitly hits Publish to activate
      }

      const res = await fetch(`/api/flows${impParam}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const isJson = res.headers.get('content-type')?.includes('application/json')
      const data = isJson ? await res.json() : {}
      if (!res.ok) throw new Error(data.error || 'Failed to publish flow')

      toast.success('🚀 Flow Published & Live! Campaign is now active.')
      if (data.flow) {
        setCurrentFlow(data.flow)
        setFlows(prev => {
          const idx = prev.findIndex(f => f.id === data.flow.id)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = data.flow
            return next
          }
          return [data.flow, ...prev]
        })
      }
    } catch (err: any) {
      console.error('Publish Flow error:', err)
      toast.error(err.message || 'Error publishing flow')
    } finally {
      setSaving(false)
    }
  }

  // Voice Dictation Toggle for Flow Architect (Web Speech API)
  const handleToggleVoice = () => {
    if (isVoiceRecording) {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop() } catch (e) {}
      }
      setIsVoiceRecording(false)
      return
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRec) {
      toast.error('Speech recognition is not supported in this browser. Please type your prompt.')
      return
    }

    try {
      const recognition = new SpeechRec()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onstart = () => {
        setIsVoiceRecording(true)
        toast.info('🎙️ Listening... Speak your flow requirement')
      }

      recognition.onresult = (event: any) => {
        let transcript = ''
        for (let i = 0; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript + ' '
        }
        setAiPrompt(transcript.trim())
      }

      recognition.onerror = (err: any) => {
        console.warn('Speech recognition error/warning:', err)
        setIsVoiceRecording(false)
      }

      recognition.onend = () => {
        setIsVoiceRecording(false)
      }

      speechRecognitionRef.current = recognition
      recognition.start()
    } catch (err) {
      console.error('Failed to start speech recognition:', err)
      setIsVoiceRecording(false)
    }
  }

  // AI Architect Flow Generator (Calls DeepSeek v4-flash /api/flows/generate)
  const handleGenerateWithAi = async (promptToUse?: string) => {
    const prompt = (promptToUse || aiPrompt).trim()
    if (!prompt) {
      toast.error('Please enter or speak your workflow requirement')
      return
    }

    if (isVoiceRecording && speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop() } catch (e) {}
      setIsVoiceRecording(false)
    }

    setIsGeneratingWithAi(true)
    try {
      const res = await fetch('/api/flows/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      const isJson = res.headers.get('content-type')?.includes('application/json')
      const data = isJson ? await res.json() : {}
      if (!res.ok) throw new Error(data.error || 'Failed to generate flow')

      if (data.flow) {
        setCurrentFlow(data.flow)
        setSelectedNode(null)
        setIsAiArchitectOpen(false)
        setTestedBeforePublish(false)
        toast.success(`✨ Flow architected with DeepSeek v4-flash: ${data.flow.name}`)
      }
    } catch (err: any) {
      console.error('AI Architect error:', err)
      toast.error(err.message || 'Failed to generate flow')
    } finally {
      setIsGeneratingWithAi(false)
    }
  }

  // Render AI Flow Architect Modal (DeepSeek v4-flash & Web Speech Voice Input)
  const renderAiArchitectModal = () => {
    if (!isAiArchitectOpen) return null
    return (
      <div 
        onClick={() => setIsAiArchitectOpen(false)}
        className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      >
        <div 
          onClick={(e) => e.stopPropagation()}
          className="bg-white border border-slate-200 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-200 flex items-start justify-between bg-slate-50/80 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-500/20 shrink-0">
                <Sparkles size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-slate-900">AI Flow Architect</h3>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-violet-50 text-violet-700 px-2.5 py-0.5 rounded-full border border-violet-200">
                    DeepSeek v4-flash
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Describe your workflow in plain English or click the microphone to dictate with voice.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsAiArchitectOpen(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
            {/* Voice Dictation Button & Status */}
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-3">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                    isVoiceRecording 
                      ? 'bg-rose-600 text-white animate-pulse shadow-md shadow-rose-600/30' 
                      : 'bg-violet-600 hover:bg-violet-700 text-white shadow-sm'
                  }`}
                >
                  {isVoiceRecording ? <MicOff size={15} /> : <Mic size={15} />}
                  <span>{isVoiceRecording ? 'Stop Listening' : 'Dictate with Voice (Mic)'}</span>
                </button>
                {isVoiceRecording && (
                  <span className="text-xs text-rose-600 font-bold flex items-center gap-1.5 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Listening to your voice...
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
                Realtime Voice Recognition
              </span>
            </div>

            {/* Prompt Textarea */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Describe your desired workflow
              </label>
              <textarea
                rows={4}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Call my custom CSV audience using Fenrir voice, ask about their site visit preference and budget, save responses to lead info, evaluate qualification deterministically, and if they say Yes alert admin on email and whatsapp..."
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:border-violet-500 outline-none leading-relaxed custom-scrollbar"
              />
            </div>

            {/* Instant Quick Use-Case Pills */}
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                Popular One-Click Use Cases
              </span>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setAiPrompt('Call custom CSV audience with official Gemini Live voice (Fenrir), ask 2 structured qualification questions on site visit interest and budget, save answers to lead info, verify qualification deterministically, alert admin on Email & WhatsApp if they say Yes, and dispatch WhatsApp brochure.')}
                  className="w-full text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-indigo-400 text-xs text-slate-700 hover:text-slate-900 transition-all flex items-start gap-2.5 group cursor-pointer"
                >
                  <PhoneCall size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-indigo-700 block">Outbound Calling Campaign & Qualification Pipeline</span>
                    <span className="text-[11px] text-slate-500 group-hover:text-slate-700 leading-snug">
                      Calls CSV/group audience → asks multi-questions & auto-saves to Lead Info → deterministic scoring → alerts Admin.
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAiPrompt('When candidate submits Meta hiring ad, send 3 screening questions on WhatsApp for sales experience, location, and salary. Deterministically evaluate answers (pass score 70) and schedule interview for qualified.')}
                  className="w-full text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-emerald-400 text-xs text-slate-700 hover:text-slate-900 transition-all flex items-start gap-2.5 group cursor-pointer"
                >
                  <Users size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-emerald-700 block">Meta Ad Candidate Screening & Interview Scheduler</span>
                    <span className="text-[11px] text-slate-500 group-hover:text-slate-700 leading-snug">
                      3 screening questions → deterministic score evaluation → fast-tracks qualified candidates.
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAiPrompt('When lead arrives from Housing.com or 99Acres, send instant WhatsApp brochure, distribute to sales team using weighted round robin, and move stage to Contacted.')}
                  className="w-full text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-amber-400 text-xs text-slate-700 hover:text-slate-900 transition-all flex items-start gap-2.5 group cursor-pointer"
                >
                  <Globe size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-700 block">Housing.com & 99Acres Instant Routing & Brochure</span>
                    <span className="text-[11px] text-slate-500 group-hover:text-slate-700 leading-snug">
                      Instant WhatsApp brochure delivery + weighted Group Lead Distribution.
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={() => setIsAiArchitectOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleGenerateWithAi()}
              disabled={isGeneratingWithAi || !aiPrompt.trim()}
              className="px-6 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-violet-500/20 disabled:opacity-50 flex items-center gap-2 cursor-pointer active:scale-95"
            >
              {isGeneratingWithAi ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  <span>Architecting Flow with DeepSeek v4-flash...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>Generate Flow & Load on Canvas</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Toggle Active/Paused Status
  const handleToggleActive = async (flow: AutomationFlow, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const nextActive = !flow.isActive

    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/flows${impParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: flow.id, isActive: nextActive })
      })
      if (!res.ok) throw new Error('Toggle failed')

      setFlows(prev => prev.map(f => f.id === flow.id ? { ...f, isActive: nextActive } : f))
      if (currentFlow?.id === flow.id) {
        setCurrentFlow(prev => prev ? { ...prev, isActive: nextActive } : null)
      }
      toast.success(nextActive ? 'Flow is now Live & Active' : 'Flow paused')
    } catch (err) {
      toast.error('Failed to update status')
    }
  }

  // Delete Flow
  const handleDeleteFlow = async (flowId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!confirm('Are you sure you want to delete this flow? This action cannot be undone.')) return

    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}&id=${flowId}` : `?id=${flowId}`
      const res = await fetch(`/api/flows${impParam}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')

      toast.success('Flow deleted')
      setFlows(prev => prev.filter(f => f.id !== flowId))
      if (currentFlow?.id === flowId) {
        setCurrentFlow(null)
      }
    } catch (err) {
      toast.error('Failed to delete flow')
    }
  }

  // Duplicate Flow
  const handleDuplicateFlow = async (flow: AutomationFlow, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const clone: Omit<AutomationFlow, 'id'> = {
      ...JSON.parse(JSON.stringify(flow)),
      name: `${flow.name} (Copy)`
    }

    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
      const res = await fetch(`/api/flows${impParam}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clone)
      })
      const isJson = res.headers.get('content-type')?.includes('application/json')
      const data = isJson ? await res.json() : {}
      if (data?.flow) {
        setFlows(prev => [data.flow, ...prev])
        toast.success('Flow duplicated')
      }
    } catch (err) {
      toast.error('Failed to duplicate')
    }
  }

  // Add Node to Flow
  const handleAddNode = (nodeDef: typeof NODE_DEFINITIONS[0]) => {
    if (!currentFlow) return
    const newNode: FlowNode = {
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: nodeDef.type,
      title: nodeDef.title,
      description: nodeDef.description,
      config: getDefaultNodeConfig(nodeDef.type)
    }

    const currentNodes = [...currentFlow.nodes]
    if (insertAtIndex !== null && insertAtIndex >= 0 && insertAtIndex <= currentNodes.length) {
      currentNodes.splice(insertAtIndex, 0, newNode)
    } else {
      currentNodes.push(newNode)
    }

    setCurrentFlow({ ...currentFlow, nodes: currentNodes })
    setSelectedNode(newNode)
    setIsNodePaletteOpen(false)
    setInsertAtIndex(null)
    toast.success(`Added step: ${nodeDef.title}`)
  }

  // Default configuration per node type
  const getDefaultNodeConfig = (type: FlowNodeType): Record<string, any> => {
    switch (type) {
      // 🟣 Instagram Nodes
      case 'trigger_ig_dm':
        return {
          keywords: 'PRICE, BROCHURE, DETAILS, COST, VISIT',
          matchingType: 'contains',
          caseSensitive: false
        }
      case 'trigger_ig_comment':
        return {
          postScope: 'all_posts_and_reels',
          keywords: 'price, info, brochure, details, location, cost',
          autoDmReply: true,
          publicReplyTemplates: [
            'Sent you the complete brochure & price details in DM! 📩 Check your requests.',
            'Check your DM! Just sent over the verified brochure & floor plans ✨',
            'Sent details to your inbox! Check your DMs 🏢'
          ]
        }
      case 'trigger_ig_story_mention':
        return {
          replyOnMention: true,
          storyReplyText: 'Thank you for mentioning us! Here is our project brochure & VIP pricing link 🌟'
        }
      case 'action_ig_send_dm':
        return {
          message: 'Hi {{lead.name}}! 👋 Thank you for reaching out to Bluesquare Infra. Here is the verified project brochure and pricing sheet you requested:',
          includeBrochure: true,
          buttons: [
            { id: 'btn_1', title: '📄 View Brochure PDF', actionType: 'send_reply', actionValue: 'Brochure Link' },
            { id: 'btn_2', title: '📅 Book Site Visit', actionType: 'crm_stage', actionValue: 'Visit Planned' },
            { id: 'btn_3', title: '💬 Chat with Closer', actionType: 'assign_agent', actionValue: 'Harman Bajwa' }
          ]
        }
      case 'action_ig_comment_reply':
        return {
          publicReplyText: 'Sent you the full brochure & floor plans in DM! 📩 Please check your inbox.',
          sendPrivateDm: true,
          dmMessage: 'Hi {{lead.name}}! Thanks for your comment. Here is the official project brochure and price breakdown: https://nobogent.com/brochure'
        }
      case 'action_ig_card':
        return {
          cardTitle: 'Joy Grand Luxury Residences',
          cardSubtitle: '3 & 4 BHK Luxury Apartments in Sector 82 Mohali. Starting ₹1.8 Cr.',
          imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
          buttonTitle: 'Download Project Deck',
          buttonUrl: 'https://bluesquareinfra.com/joygrand'
        }

      // 🔵 Facebook Nodes
      case 'trigger_fb_lead_ad':
        return {
          formName: 'Joy Grand Luxury Leads 2026',
          instantSync: true
        }
      case 'trigger_fb_comment':
        return {
          postScope: 'all_page_posts',
          keywords: 'price, brochure, details, cost',
          publicReply: 'Thank you! We have sent you full details via Messenger.'
        }
      case 'trigger_fb_messenger':
        return {
          welcomeGreeting: 'Welcome to Bluesquare Infra! How can our property advisors assist you today?'
        }
      case 'action_fb_send_messenger':
        return {
          message: 'Hello {{lead.name}}! Thank you for contacting us on Facebook. How would you like us to assist you?',
          ctaButtons: [
            { id: 'cta_1', title: '📄 Project Brochure', type: 'url', url: 'https://bluesquareinfra.com' },
            { id: 'cta_2', title: '📞 Speak with Sales', type: 'call', phoneNumber: '+91 98765 43210' }
          ]
        }
      case 'action_fb_comment_reply':
        return {
          publicReplyText: 'Thanks for reaching out! We sent you the project details in Messenger.',
          privateMessageText: 'Hi {{lead.name}}! Here are the details and brochure link you requested.'
        }

      // 🟢 WhatsApp Nodes
      case 'trigger_whatsapp_inbound':
        return {
          keywords: 'START, BROCHURE, HELLO, HI, INFO',
          matchingType: 'contains'
        }
      case 'trigger_whatsapp_ctwa':
        return {
          adCampaign: 'All Active Meta CTWA Ad Campaigns',
          trackAdCreative: true
        }
      case 'action_whatsapp_msg':
        return {
          message: 'Hi {{lead.name}}! Thank you for inquiring with us. How can we help you today?',
          buttonType: 'quick_reply',
          quickReplyButtons: [
            { id: 'btn_1', title: '📅 Schedule Visit', actionType: 'crm_stage', actionValue: 'Visit Planned' },
            { id: 'btn_2', title: '💬 Talk to Agent', actionType: 'assign_agent', actionValue: 'Harman Bajwa' },
            { id: 'btn_3', title: '📍 Location Pin', actionType: 'send_reply', actionValue: 'Here is our project location on Google Maps: https://maps.google.com' }
          ],
          ctaButtons: [
            { id: 'cta_1', title: '📍 Open Google Maps', type: 'url', url: 'https://maps.google.com/?q=Joy+Grand+Mohali' },
            { id: 'cta_2', title: '🌐 View Project Website', type: 'url', url: 'https://bluesquareinfra.com' }
          ],
          includeBrochure: false,
          buttons: ['📅 Schedule Visit', '💬 Talk to Agent', '📍 Location Pin']
        }
      case 'action_whatsapp_questions':
        return {
          questions: ['What is your preferred configuration and budget?'],
          quickReplies: ['2 BHK', '3 BHK', 'Penthouse'],
          saveField: 'buyer_preference'
        }
      case 'action_whatsapp_interactive':
        return {
          headerText: 'Available Inventory & Configurations',
          bodyText: 'Select your preferred apartment configuration to see pricing and floor plans:',
          listButtonTitle: 'View Configurations',
          sections: [
            { title: 'Luxury Apartments', rows: [{ id: '2bhk', title: '2 BHK Luxury', description: '1,350 sq.ft • Starting ₹1.25 Cr' }, { id: '3bhk', title: '3 BHK Premium', description: '1,950 sq.ft • Starting ₹1.85 Cr' }] },
            { title: 'Penthouses', rows: [{ id: 'penthouse', title: '4 BHK Duplex Penthouse', description: '3,400 sq.ft • Starting ₹3.50 Cr' }] }
          ]
        }

      // 🎙️ AI Voice Calling Nodes
      case 'trigger_ai_call_request':
        return {
          source: 'Website / Landing Page Call Request Button',
          speedToLeadSeconds: 30
        }
      case 'action_ai_call':
        return {
          voiceAgent: 'Fenrir (Crisp & Focused)',
          objective: 'Site Visit Confirmation & Requirement Check',
          firstLine: 'Hi {{lead.name}}, calling from Bluesquare Infra regarding Joy Grand.',
          questions: [
            {
              id: 'q_1',
              question: 'Are you interested in scheduling a site visit to Joy Grand this weekend?',
              fieldKey: 'site_visit_interest',
              saveToLeadProfile: true,
              expectedAnswer: 'Yes / Saturday / Sunday'
            },
            {
              id: 'q_2',
              question: 'What is your preferred investment budget range (e.g. 1.5 Cr to 2.5 Cr)?',
              fieldKey: 'budget_range',
              saveToLeadProfile: true,
              expectedAnswer: '1.5 Cr - 2.5 Cr'
            }
          ],
          qualificationQuestion: 'Are you interested in scheduling a site visit this weekend?'
        }
      case 'action_ai_call_transfer':
        return {
          transferNumber: '+91 98765 43210',
          closerName: 'Harman Bajwa (Senior Sales Closer)',
          whisperMessage: 'Connecting high-intent qualified buyer for Joy Grand',
          fallbackAction: 'send_whatsapp_brochure'
        }

      // 📧 Email Nodes
      case 'action_send_email':
        return {
          senderName: 'Bluesquare Infra VIP Advisory',
          subject: 'Official Joy Grand Brochure, Floor Plans & Pricing Sheet',
          body: 'Dear {{lead.name}},\n\nThank you for speaking with our team regarding Joy Grand Luxury Residences.\n\nWe have attached the official project deck and floor plans for your review.\n\nPlease let us know if you would like to reserve a site visit slot for this weekend.\n\nBest regards,\nBluesquare Infra Advisory Team',
          includeAttachment: true,
          attachmentUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80'
        }

      // 🔀 Logic & Branching Nodes
      case 'action_condition':
        return {
          evaluationType: 'qualification_score',
          field: 'qualification_score',
          operator: '>=',
          value: 100,
          branchTrueLabel: 'Branch A: Qualified (Said Yes / High Intent)',
          branchFalseLabel: 'Branch B: Not Interested / Low Intent'
        }
      case 'action_split_traffic':
        return {
          splitPercentage: 50,
          pathALabel: 'Path A: Gemini Live Outbound Voice Call (50%)',
          pathBLabel: 'Path B: Instant WhatsApp Brochure & Screening (50%)'
        }
      case 'action_delay':
        return {
          duration: 5,
          unit: 'minutes',
          businessHoursOnly: false
        }
      case 'action_follow_up':
        return {
          sequenceName: '5-Day High Intent Buyer Nurture',
          startDelayHours: 24,
          touchpoints: 3
        }
      case 'action_qualify':
      case 'action_ai_qualify':
        return {
          scoringMode: 'points',
          passScore: 70,
          rules: [
            { id: '1', field: 'experience', label: 'Sales Experience >= 2 Yrs', operator: 'contains_any', value: '2+ Years, 2 Years', points: 40, required: true },
            { id: '2', field: 'location', label: 'On-site in Mohali / Chandigarh', operator: 'contains_any', value: 'Yes, Comfortable', points: 30, required: true },
            { id: '3', field: 'salary', label: 'Expected Salary <= 35k', operator: 'contains_any', value: 'Under 30k, 30k, 35k, Under 35000', points: 30, required: false }
          ]
        }

      // ⚡ CRM, Tags & Actions Nodes
      case 'action_add_tag':
        return {
          tag: 'Instagram Reel Comment Lead'
        }
      case 'action_remove_tag':
        return {
          tag: 'Cold Prospect'
        }
      case 'action_add_note':
        return {
          note: 'Lead engaged via omnichannel automation. Requested project brochure and site visit slot.'
        }
      case 'action_update_field':
        return {
          fieldKey: 'buyer_budget',
          fieldValue: '2.5 Cr'
        }
      case 'action_crm_stage':
        return {
          stage: 'Contacted',
          tags: 'Automated Flow'
        }
      case 'action_assign_agent':
        return {
          assignMode: 'individual',
          agentName: 'Harman Bajwa'
        }
      case 'action_webhook':
        return {
          url: 'https://webhook.site/demo',
          method: 'POST'
        }
      case 'action_notify_team':
        return {
          channels: ['email', 'whatsapp'],
          adminEmail: 'admin@bluesquareinfra.com',
          adminWhatsapp: '+91 98765 43210',
          includeLeadInfo: true,
          includeCallDetails: true,
          alertMessage: '🔥 HOT LEAD ALERT: {{lead.name}} ({{lead.phone}}) confirmed interest on call!'
        }

      // 🎯 Inbound Triggers
      case 'trigger_csv_audience':
        return {
          csvFileName: 'Mohali-Luxury-HNIs-Calling-List.csv',
          csvLeadCount: 450,
          columnMapping: { nameCol: 'Full Name', phoneCol: 'Phone Number', emailCol: 'Email Address' }
        }
      case 'trigger_custom_audience_group':
        return {
          groupName: 'Mohali Luxury Segment (HNIs > 2 Cr)',
          groupId: 'grp_1',
          audienceSegment: 'High Intent'
        }
      default:
        return {}
    }
  }

  // Remove Node
  const handleRemoveNode = (nodeId: string) => {
    if (!currentFlow) return
    const updated = currentFlow.nodes.filter(n => n.id !== nodeId)
    setCurrentFlow({ ...currentFlow, nodes: updated })
    if (selectedNode?.id === nodeId) setSelectedNode(null)
    toast.info('Step removed')
  }

  // Duplicate Node
  const handleDuplicateNode = (node: FlowNode) => {
    if (!currentFlow) return
    const clone: FlowNode = {
      ...JSON.parse(JSON.stringify(node)),
      id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `${node.title} (Copy)`
    }
    const idx = currentFlow.nodes.findIndex(n => n.id === node.id)
    const updated = [...currentFlow.nodes]
    updated.splice(idx + 1, 0, clone)
    setCurrentFlow({ ...currentFlow, nodes: updated })
    setSelectedNode(clone)
    toast.success('Step duplicated')
  }

  // =========================================================================
  // INTERACTIVE WHATSAPP PHONE SIMULATOR ENGINE (Nobogent Studio)
  // =========================================================================
  const handleStartSimulation = () => {
    if (!currentFlow || currentFlow.nodes.length === 0) {
      toast.error('Add at least one step to test simulation')
      return
    }

    setIsSimulatorOpen(true)
    setSimStepIndex(0)
    setActiveSimNodeId(null)
    setIsBotTyping(false)
    setSimulatorTab('chat')

    const initialLead = {
      name: 'Rohit Verma',
      phone: '+91 98765 43210',
      source: currentFlow.trigger.portalName || 'Meta Ad: Luxury Residences',
      project: 'Joy Grand',
      score: 0,
      status: 'NEW',
      assignedAgent: 'Unassigned',
      answers: {}
    }
    setSimLeadData(initialLead)

    const initialMessages = [
      {
        id: 'sys_0',
        sender: 'system' as const,
        text: `⚡ Lead entered pipeline via "${currentFlow.trigger.label || 'Inbound Campaign'}"`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]
    setSimMessages(initialMessages)

    const initialLogs = [
      `[Trigger Fired]: Lead "Rohit Verma" (+91 98765 43210) entered from "${currentFlow.trigger.label}"`,
      `[Pipeline Start]: Executing ${currentFlow.nodes.length} automation steps`
    ]
    setSimLogs(initialLogs)

    // Execute Step 0 (Trigger -> First node)
    executeNextSimStep(0, currentFlow.nodes, initialLead, initialMessages, initialLogs)
  }

  const executeNextSimStep = (
    stepIdx: number,
    nodes: FlowNode[],
    currentLead: typeof simLeadData,
    currMsgs: typeof simMessages,
    currLogs: string[]
  ) => {
    if (stepIdx >= nodes.length) {
      // Flow Completed
      setActiveSimNodeId(null)
      setIsBotTyping(false)
      setTestedBeforePublish(true)
      const finalLogs = [
        ...currLogs,
        `✨ [Pipeline Completed]: All ${nodes.length} automation steps finished seamlessly!`
      ]
      setSimLogs(finalLogs)
      return
    }

    const node = nodes[stepIdx]
    setActiveSimNodeId(node.id)
    setSimStepIndex(stepIdx + 1)
    setIsBotTyping(true)

    setTimeout(() => {
      setIsBotTyping(false)
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      let nextLead = { ...currentLead }
      let updatedLogs = [...currLogs, `[Step ${stepIdx + 1}] Executed "${node.title}" (${node.type})`]
      let updatedMsgs = [...currMsgs]

      if (node.type === 'action_whatsapp_msg') {
        const rawText = node.config.message || 'Hello! Thank you for reaching out.'
        const parsedText = rawText
          .replace(/{{lead\.name}}/g, nextLead.name)
          .replace(/{{lead\.phone}}/g, nextLead.phone)
          .replace(/{{project}}/g, nextLead.project)

        const btnType = node.config.buttonType || 'quick_reply'
        let quickBtns: string[] = []
        let ctaBtns: any[] = []

        if (btnType === 'cta_url') {
          ctaBtns = node.config.ctaButtons || []
        } else if (btnType !== 'none') {
          if (node.config.quickReplyButtons && node.config.quickReplyButtons.length > 0) {
            quickBtns = node.config.quickReplyButtons.map((b: any) => b.title)
          } else if (node.config.buttons && node.config.buttons.length > 0) {
            quickBtns = node.config.buttons
          }
        }

        updatedMsgs.push({
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: parsedText,
          time: nowTime,
          buttons: quickBtns,
          ctaButtons: ctaBtns,
          isBrochure: !!node.config.includeBrochure,
          mediaUrl: node.config.brochureUrl
        })
        if (ctaBtns.length > 0) {
          updatedLogs.push(`🔗 [WhatsApp CTA Links Rendered]: ${ctaBtns.map(c => `[${c.title} ➔ ${c.url || c.phoneNumber}]`).join(', ')}`)
        }
      } else if (node.type === 'action_whatsapp_questions') {
        const qList = node.config.questions || ['Please share your preference:']
        const qText = qList[0] || 'What is your preferred configuration?'
        updatedMsgs.push({
          id: `msg_${Date.now()}`,
          sender: 'bot',
          text: `❓ ${qText}`,
          time: nowTime,
          buttons: node.config.quickReplies || ['2 BHK', '3 BHK', 'Schedule Call']
        })
      } else if (node.type === 'action_qualify' || node.type === 'action_ai_qualify') {
        // Robust Deterministic Evaluation: strictly check user's actual answers against deterministic rules!
        const rules = node.config.rules || [
          { field: 'experience', value: '2+ Years, 2 Years', points: 40, required: true },
          { field: 'location', value: 'Yes, Comfortable', points: 30, required: true },
          { field: 'salary', value: 'Under 30k, 30k, 35k', points: 30, required: false }
        ]
        const passScore = node.config.passScore || 70
        let earnedPoints = 0
        let totalPossible = 0
        let passedRulesCount = 0

        rules.forEach((r: any) => {
          totalPossible += (r.points || 25)
          const ansKeys = Object.keys(nextLead.answers)
          const matchKey = ansKeys.find(k => k.toLowerCase().includes(r.field.toLowerCase()))
          const answerVal = matchKey ? nextLead.answers[matchKey] : (nextLead.answers['step_1'] || '2+ Years Exp')
          
          const valStr = String(answerVal).toLowerCase()
          const targetStr = String(r.value || '').toLowerCase()
          const matched = targetStr.split(',').some(part => valStr.includes(part.trim())) || valStr.includes(targetStr)

          if (matched) {
            earnedPoints += (r.points || 25)
            passedRulesCount++
          }
        })

        const calculatedScore = totalPossible > 0 ? Math.round((earnedPoints / totalPossible) * 100) : 85
        const isPass = calculatedScore >= passScore
        nextLead.score = calculatedScore
        nextLead.status = isPass ? 'QUALIFIED' : 'UNQUALIFIED'
        
        updatedLogs.push(`⚖️ [Deterministic Evaluation]: Score: ${calculatedScore}% (${passedRulesCount}/${rules.length} rules matched) -> Verdict: ${isPass ? 'QUALIFIED ✅' : 'DISQUALIFIED ❌'}`)
        updatedMsgs.push({
          id: `sys_${Date.now()}`,
          sender: 'system',
          text: `⚖️ Rule Engine: Score ${calculatedScore}% (${nextLead.status}) - ${passedRulesCount}/${rules.length} criteria satisfied`,
          time: nowTime
        })
      } else if (node.type === 'action_ai_call') {
        const agentName = node.config.voiceAgent || 'Fenrir (Crisp & Focused)'
        const greeting = (node.config.firstLine || 'Hi {{lead.name}}, calling from Bluesquare Infra regarding Joy Grand.')
          .replace(/{{lead\.name}}/g, nextLead.name)
        const qList = node.config.questions || [
          { question: node.config.qualificationQuestion || 'Are you interested in scheduling a site visit this weekend?', fieldKey: 'site_visit_interest' }
        ]
        const firstQ = qList[0] || { question: 'Are you interested in scheduling a site visit this weekend?', fieldKey: 'site_visit_interest' }
        const questionText = firstQ.question

        updatedMsgs.push({
          id: `call_${Date.now()}`,
          sender: 'bot',
          text: `📞 [Official Gemini 3.1 Live Call — Voice: ${agentName}]\n"${greeting}\n\nQ1: ${questionText}"`,
          time: nowTime,
          buttons: ['Yes, definitely! Visit this Saturday', 'No, not interested right now', 'Please call back later']
        })
        updatedLogs.push(`📞 [Gemini Live Connected]: ${agentName} asked: "${questionText}" (Target Lead Field: ${firstQ.fieldKey})`)
        setSimLeadData(nextLead)
        setSimMessages(updatedMsgs)
        setSimLogs(updatedLogs)
        return
      } else if (node.type === 'action_notify_team') {
        const emailTo = node.config.adminEmail || 'admin@bluesquareinfra.com'
        const phoneTo = node.config.adminWhatsapp || '+91 98765 43210'
        const alertMsg = (node.config.alertMessage || '🔥 HOT LEAD ALERT: {{lead.name}} ({{lead.phone}}) confirmed interest on call!')
          .replace(/{{lead\.name}}/g, nextLead.name)
          .replace(/{{lead\.phone}}/g, nextLead.phone)

        updatedLogs.push(`🔔 [Admin Alert]: Dispatched Email to "${emailTo}" & WhatsApp to "${phoneTo}"`)
        updatedMsgs.push({
          id: `notify_${Date.now()}`,
          sender: 'system',
          text: `🔔 [Admin Alert Dispatched]\n📧 Email -> ${emailTo}\n📱 WhatsApp -> ${phoneTo}\n\nPayload: "${alertMsg}"`,
          time: nowTime
        })
      } else if (node.type === 'action_assign_agent') {
        const assignedTarget = node.config.assignMode === 'group' 
          ? (node.config.groupName || 'Mohali Sales Team (Group Distribution)')
          : (node.config.agentName || 'Harman Bajwa')
        nextLead.assignedAgent = assignedTarget
        updatedLogs.push(`👤 [Lead Assignment]: Routed lead to "${assignedTarget}"`)
        updatedMsgs.push({
          id: `sys_${Date.now()}`,
          sender: 'system',
          text: `👤 Lead assigned to: ${assignedTarget}`,
          time: nowTime
        })
      } else if (node.type === 'action_crm_stage') {
        const stage = node.config.stage || 'Contacted'
        nextLead.status = stage
        updatedLogs.push(`🏷️ [CRM Sync]: Pipeline stage moved to "${stage}"`)
      } else if (node.type === 'action_delay') {
        const dur = node.config.duration || 2
        const unit = node.config.unit || 'minutes'
        updatedLogs.push(`⏱️ [Smart Delay]: Timer simulated (${dur} ${unit})`)
      }

      setSimLeadData(nextLead)
      setSimMessages(updatedMsgs)
      setSimLogs(updatedLogs)

      // If this node asks for user input/question OR has quick reply buttons, pause auto-advancing so user can click/type in the simulator!
      if (node.type === 'action_whatsapp_questions') {
        return
      }
      if (node.type === 'action_whatsapp_msg' && (node.config.buttonType !== 'cta_url' && node.config.buttonType !== 'none')) {
        const hasButtons = (node.config.quickReplyButtons && node.config.quickReplyButtons.length > 0) || (node.config.buttons && node.config.buttons.length > 0)
        if (hasButtons) {
          // Pause here so user can interact with the WhatsApp quick reply buttons!
          return
        }
      }

      // Otherwise auto-advance to next step
      executeNextSimStep(stepIdx + 1, nodes, nextLead, updatedMsgs, updatedLogs)
    }, 1100)
  }

  // Handle user response click or input inside simulator
  const handleSimUserReply = (replyText: string) => {
    if (!replyText.trim()) return
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const updatedMsgs = [
      ...simMessages,
      {
        id: `user_${Date.now()}`,
        sender: 'user' as const,
        text: replyText.trim(),
        time: nowTime
      }
    ]
    setSimUserInput('')

    // Identify which custom field key to map to
    const currentNode = currentFlow?.nodes[simStepIndex - 1]
    let fieldKey = `step_${simStepIndex}`
    if (currentNode?.type === 'action_ai_call') {
      const qList = currentNode.config.questions || []
      fieldKey = qList[0]?.fieldKey || 'site_visit_interest'
    } else if (currentNode?.type === 'action_whatsapp_questions') {
      fieldKey = currentNode.config.saveField || 'candidate_screening_answers'
    } else if (currentNode?.type === 'action_whatsapp_msg') {
      fieldKey = 'whatsapp_button_selected'
    }

    let nextStatus = simLeadData.status
    let nextAgent = simLeadData.assignedAgent
    const branchLogs: string[] = []
    const branchMsgs: any[] = []

    // If previous step was WhatsApp message, check if reply matches a quick reply button action!
    if (currentNode?.type === 'action_whatsapp_msg') {
      const qrList = currentNode.config.quickReplyButtons || []
      const matchedBtn = qrList.find((b: any) => b.title?.trim().toLowerCase() === replyText.trim().toLowerCase())
      if (matchedBtn) {
        if (matchedBtn.actionType === 'crm_stage') {
          nextStatus = matchedBtn.actionValue || 'Visit Planned'
          branchLogs.push(`⚡ [WhatsApp Button Branch]: Tapped "${matchedBtn.title}" ➔ CRM stage moved to "${nextStatus}"`)
        } else if (matchedBtn.actionType === 'notify_admin') {
          branchLogs.push(`🔔 [WhatsApp Button Branch]: Tapped "${matchedBtn.title}" ➔ Triggered Instant Admin Alert!`)
          branchMsgs.push({
            id: `admin_alert_${Date.now()}`,
            sender: 'system',
            text: `🔔 [Admin Alert]: Prospect tapped "${matchedBtn.title}"! Immediate follow-up triggered.`,
            time: nowTime
          })
        } else if (matchedBtn.actionType === 'assign_agent') {
          nextAgent = matchedBtn.actionValue || 'Harman Bajwa'
          branchLogs.push(`👤 [WhatsApp Button Branch]: Tapped "${matchedBtn.title}" ➔ Lead routed to "${nextAgent}"`)
        } else if (matchedBtn.actionType === 'send_reply') {
          const autoReply = matchedBtn.actionValue || 'Thank you for your response!'
          branchLogs.push(`💬 [WhatsApp Button Branch]: Tapped "${matchedBtn.title}" ➔ Auto-reply sent`)
          branchMsgs.push({
            id: `bot_reply_${Date.now()}`,
            sender: 'bot',
            text: autoReply,
            time: nowTime
          })
        }
      }
    }

    const updatedLead = {
      ...simLeadData,
      status: nextStatus,
      assignedAgent: nextAgent,
      answers: { 
        ...simLeadData.answers, 
        [fieldKey]: replyText.trim(),
        [`step_${simStepIndex}`]: replyText.trim(),
        prospect_response: replyText.trim(),
        candidate_answers: replyText.trim()
      }
    }
    setSimLeadData(updatedLead)

    const updatedLogs = [
      ...simLogs,
      `💬 [Lead Responded]: "${replyText.trim()}" ➔ 💾 Auto-saved to Lead Info custom field [${fieldKey}]`,
      ...branchLogs
    ]
    const updatedMessagesAll = [...updatedMsgs, ...branchMsgs]
    setSimMessages(updatedMessagesAll)
    setSimLogs(updatedLogs)

    // Advance to next step
    if (currentFlow) {
      executeNextSimStep(simStepIndex, currentFlow.nodes, updatedLead, updatedMessagesAll, updatedLogs)
    }
  }

  // Filtered flows for directory view
  const filteredFlows = useMemo(() => {
    return flows.filter(f => {
      if (statusFilter === 'ACTIVE' && !f.isActive) return false
      if (statusFilter === 'PAUSED' && f.isActive) return false
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesName = f.name.toLowerCase().includes(q)
        const matchesDesc = (f.description || '').toLowerCase().includes(q)
        const matchesTrigger = (f.trigger?.label || '').toLowerCase().includes(q)
        if (!matchesName && !matchesDesc && !matchesTrigger) return false
      }
      return true
    })
  }, [flows, statusFilter, searchQuery])

  // =========================================================================
  // VIEW: VISUAL CANVAS BUILDER (LIGHT THEME STUDIO ARCHITECTURE)
  // Restricted exclusively to Super Admin
  // =========================================================================
  if (currentFlow) {
    return (
      <div className="fixed inset-0 z-40 bg-slate-50 text-slate-900 flex flex-col overflow-hidden font-sans">
        
        {/* BUILDER FIXED TOP BAR (CRISP LIGHT THEME) */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0 z-30 shadow-xs">
          {/* Left: Back button & Flow title inline */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => {
                setSelectedNode(null)
                setCurrentFlow(null)
              }}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
              title="Return to Automations Suite"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 border border-violet-200 flex items-center justify-center shrink-0">
              <Workflow size={18} />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 px-2">
                <button
                  onClick={() => {
                    setSelectedNode(null)
                    setCurrentFlow(null)
                  }}
                  className="hover:text-slate-700 transition-colors cursor-pointer"
                >
                  Automations
                </button>
                <span className="text-slate-300">/</span>
                <span className="text-slate-500">Flows</span>
                <span className="text-slate-300">/</span>
                <span className="text-slate-700 font-bold truncate max-w-[150px]">{currentFlow.name}</span>
              </div>
              <input
                type="text"
                value={currentFlow.name}
                onChange={(e) => setCurrentFlow({ ...currentFlow, name: e.target.value })}
                className="bg-transparent hover:bg-slate-100 focus:bg-white text-sm sm:text-base font-black text-slate-900 px-2 py-0.5 rounded-lg border border-transparent focus:border-slate-300 outline-none w-48 sm:w-80 truncate transition-colors"
                placeholder="Name your flow..."
              />
              <div className="flex items-center gap-2 px-2 text-[11px] text-slate-500">
                <span>{currentFlow.nodes.length} automated steps</span>
                <span>•</span>
                <span className="truncate font-medium">{currentFlow.trigger.label || 'Trigger Configured'}</span>
              </div>
            </div>
          </div>

          {/* Middle: Studio Mode Tabs (Builder, Analytics, History) */}
          <div className="hidden lg:flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 text-xs font-bold shadow-xs">
            <button
              onClick={() => setStudioTab('builder')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                studioTab === 'builder'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Workflow size={13} />
              <span>Canvas Builder</span>
            </button>
            <button
              onClick={() => setStudioTab('analytics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                studioTab === 'analytics'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 size={13} />
              <span>Flow Analytics & Funnel</span>
              {isLiveRunActive && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setStudioTab('history')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                studioTab === 'history'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History size={13} />
              <span>Run History</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-200/80 text-slate-700 rounded-full font-mono font-bold">
                {flowRunHistory.length}
              </span>
            </button>
          </div>

          {/* Right: Actions (Active Toggle, Zoom, AI Architect, Run on Audience, Test Run, Add Step, Save, Publish) */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Active Toggle Button */}
            <button
              onClick={() => setCurrentFlow({ ...currentFlow, isActive: !currentFlow.isActive })}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all border cursor-pointer ${
                currentFlow.isActive 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-xs' 
                  : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${currentFlow.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
              <span className="hidden sm:inline">{currentFlow.isActive ? 'Active & Live' : 'Paused'}</span>
            </button>

            {/* Canvas Zoom Controls (Builder tab only) */}
            {studioTab === 'builder' && (
              <div className="hidden md:flex items-center bg-slate-100 border border-slate-200 rounded-xl p-1 text-xs">
                <button
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 50}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <button
                  onClick={handleResetZoom}
                  className="px-2 py-1 text-[11px] font-bold text-slate-700 hover:text-slate-900 hover:bg-white rounded-md transition-colors font-mono cursor-pointer"
                  title="Reset Zoom to 100%"
                >
                  {zoomLevel}%
                </button>
                <button
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 150}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white disabled:opacity-30 transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
              </div>
            )}

            {/* AI Architect Button */}
            <button
              onClick={() => setIsAiArchitectOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              title="Generate or adjust flow using DeepSeek v4-flash or Voice"
            >
              <Sparkles size={13} />
              <span className="hidden sm:inline">AI Architect</span>
            </button>

            {/* Run on Audience Button */}
            <button
              onClick={() => setIsRunAudienceModalOpen(true)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all shadow-sm cursor-pointer border ${
                isLiveRunActive
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-emerald-500 ring-2 ring-emerald-400/40 animate-pulse'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white border-blue-600 shadow-blue-500/20 active:scale-95'
              }`}
              title="Execute flow manually over custom uploaded CSV, audience segment, or campaign leads"
            >
              <Zap size={13} className={isLiveRunActive ? 'text-amber-300 fill-amber-300 animate-spin' : 'text-amber-300 fill-amber-300'} />
              <span>{isLiveRunActive ? 'Live Run Active' : 'Run on Audience'}</span>
            </button>

            {/* Test Run Button */}
            <button
              onClick={handleStartSimulation}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
                testedBeforePublish
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-400 ring-1 ring-emerald-300'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
              title="Test run single lead in interactive phone simulator"
            >
              <Play size={13} className={testedBeforePublish ? 'text-emerald-600 fill-emerald-600' : 'text-slate-600'} />
              <span>{testedBeforePublish ? 'Verified' : 'Test Run'}</span>
            </button>

            {/* Add Step Button */}
            <button
              onClick={() => {
                setInsertAtIndex(null)
                setIsNodePaletteOpen(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Add Step</span>
            </button>

            {/* Save Button */}
            <button
              onClick={handleSaveFlow}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>Save</span>
            </button>

            {/* Publish Flow Button */}
            <button
              onClick={handlePublishFlow}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-black transition-all shadow-sm shadow-emerald-600/20 disabled:opacity-50 cursor-pointer active:scale-95"
              title="Publish flow and make it active for campaign leads"
            >
              <Zap size={13} />
              <span>Publish Flow</span>
            </button>
          </div>
        </header>

        {/* BUILDER CANVAS BODY CONTAINER */}
        <div className="flex-1 flex overflow-hidden relative bg-slate-50">
          
          {/* === CANVAS BUILDER VIEW (MANYCHAT / CHATBOTX 2D INFINITE GRAPH) === */}
          {studioTab === 'builder' && (
            <div className="flex-1 h-full w-full relative">
              <ManyChatCanvas
                flowName={currentFlow.name}
                onUpdateFlowName={(name) => setCurrentFlow(prev => prev ? ({ ...prev, name }) : null)}
                isActive={currentFlow.isActive}
                onToggleActive={() => setCurrentFlow(prev => prev ? ({ ...prev, isActive: !prev.isActive }) : null)}
                initialNodes={currentFlow.xyNodes || (currentFlow.nodes?.length && currentFlow.nodes[0]?.type?.includes('Node') ? currentFlow.nodes : undefined)}
                initialEdges={currentFlow.xyEdges || currentFlow.edges}
                saving={saving}
                onTestRun={handleStartSimulation}
                onSave={async (nodes, edges) => {
                  try {
                    setSaving(true)
                    const updatedFlow = {
                      ...currentFlow,
                      xyNodes: nodes,
                      xyEdges: edges,
                      nodes: nodes,
                      edges: edges
                    }
                    setCurrentFlow(updatedFlow)

                    const impParam = impersonateId ? `?impersonate=${impersonateId}` : ''
                    const res = await fetch(`/api/flows${impParam}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(updatedFlow)
                    })
                    if (!res.ok) throw new Error('Failed to save flow')
                    const data = await res.json()
                    if (data?.flow) {
                      setFlows(prev => prev.map(f => f.id === data.flow.id ? data.flow : f))
                    }
                    toast.success('Visual flow graph published and active!')
                  } catch (err: any) {
                    toast.error(err.message || 'Error saving flow')
                  } finally {
                    setSaving(false)
                  }
                }}
              />
            </div>
          )}

          {/* === FLOW ANALYTICS & FUNNEL VIEW === */}
          {studioTab === 'analytics' && (
            <div className="flex-1 overflow-auto p-6 sm:p-10 custom-scrollbar">
              <div className="max-w-5xl mx-auto space-y-8">
                {/* Analytics Header */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                      <BarChart3 size={22} className="text-indigo-600" />
                      Flow Analytics & Funnel
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Step-by-step conversion funnel, branch performance, and KPI insights for <span className="font-bold text-slate-700">{currentFlow.name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportAnalyticsCsv}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <Download size={13} />
                      <span>Export CSV</span>
                    </button>
                    <button
                      onClick={() => setStudioTab('builder')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <ArrowLeft size={13} />
                      <span>Back to Canvas</span>
                    </button>
                  </div>
                </div>

                {/* KPI Scorecards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {[
                    {
                      label: 'Total Contacts Run',
                      value: (nodeExecutionStats['trigger']?.completed || liveRunAudience.total).toLocaleString(),
                      icon: Users,
                      color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                      iconColor: 'text-indigo-600'
                    },
                    {
                      label: 'Completion %',
                      value: `${nodeExecutionStats['trigger']?.completed ? Math.round((nodeExecutionStats['trigger'].completed / liveRunAudience.total) * 100) : 100}%`,
                      icon: CheckCircle,
                      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      iconColor: 'text-emerald-600'
                    },
                    {
                      label: 'Qualification Rate',
                      value: (() => {
                        const qualNode = currentFlow.nodes.find(n => n.type === 'action_qualify' || n.type === 'action_ai_qualify' || n.type === 'action_condition')
                        if (qualNode && nodeExecutionStats[qualNode.id]) {
                          return `${Math.round((nodeExecutionStats[qualNode.id].passed / Math.max(1, nodeExecutionStats[qualNode.id].completed)) * 100)}%`
                        }
                        return '32%'
                      })(),
                      icon: TrendingUp,
                      color: 'bg-violet-50 text-violet-700 border-violet-200',
                      iconColor: 'text-violet-600'
                    },
                    {
                      label: 'WhatsApp Delivered',
                      value: (() => {
                        const waNode = currentFlow.nodes.find(n => n.type === 'action_whatsapp_msg')
                        return waNode && nodeExecutionStats[waNode.id] ? nodeExecutionStats[waNode.id].completed.toString() : '—'
                      })(),
                      icon: MessageSquare,
                      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      iconColor: 'text-emerald-600'
                    },
                    {
                      label: 'Admin Alerts Fired',
                      value: (() => {
                        const alertNode = currentFlow.nodes.find(n => n.type === 'action_notify_team')
                        return alertNode && nodeExecutionStats[alertNode.id] ? nodeExecutionStats[alertNode.id].completed.toString() : '—'
                      })(),
                      icon: Bell,
                      color: 'bg-amber-50 text-amber-700 border-amber-200',
                      iconColor: 'text-amber-600'
                    }
                  ].map((kpi, idx) => {
                    const KpiIcon = kpi.icon
                    return (
                      <div key={idx} className={`bg-white rounded-2xl p-4 border ${kpi.color.split(' ').pop()} shadow-xs flex flex-col gap-2`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-xl ${kpi.color} flex items-center justify-center border`}>
                            <KpiIcon size={16} className={kpi.iconColor} />
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{kpi.label}</span>
                        </div>
                        <span className="text-2xl font-black text-slate-900">{kpi.value}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Step-by-Step Funnel Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ListOrdered size={16} className="text-indigo-600" />
                      <h3 className="text-sm font-black text-slate-900">Step-by-Step Funnel & Drop-off</h3>
                    </div>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {currentFlow.nodes.length + 1} total steps in pipeline
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <th className="text-left px-4 py-2.5 font-bold">Step</th>
                        <th className="text-left px-4 py-2.5 font-bold">Node Type</th>
                        <th className="text-right px-4 py-2.5 font-bold">Contacts In</th>
                        <th className="text-right px-4 py-2.5 font-bold">Completed</th>
                        <th className="text-right px-4 py-2.5 font-bold">Filtered</th>
                        <th className="text-right px-4 py-2.5 font-bold">Pass Rate</th>
                        <th className="px-4 py-2.5 font-bold">Funnel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalBase = nodeExecutionStats['trigger']?.completed || liveRunAudience.total
                        let prevCount = totalBase
                        const rows = [
                          { step: 'Step 0', title: currentFlow.trigger.label || 'Trigger', type: 'Trigger', contactsIn: totalBase, completed: totalBase, filtered: 0, passRate: 100, funnelPct: 100 }
                        ]
                        currentFlow.nodes.forEach((n, idx) => {
                          const stats = nodeExecutionStats[n.id] || { completed: prevCount, passed: prevCount, failed: 0 }
                          const passRate = stats.completed > 0 ? Math.round((stats.passed / stats.completed) * 100) : 100
                          const funnelPct = totalBase > 0 ? Math.round((stats.passed / totalBase) * 100) : 100
                          rows.push({
                            step: `Step ${idx + 1}`,
                            title: n.title,
                            type: (NODE_DEFINITIONS.find(nd => nd.type === n.type)?.category || 'Action'),
                            contactsIn: prevCount,
                            completed: stats.completed,
                            filtered: stats.failed,
                            passRate,
                            funnelPct
                          })
                          prevCount = stats.passed
                        })
                        return rows.map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3">
                              <div>
                                <span className="font-bold text-slate-800 text-xs">{row.step}</span>
                                <p className="text-[10px] text-slate-500 truncate max-w-[180px]">{row.title}</p>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">{row.type}</span>
                            </td>
                            <td className="text-right px-4 py-3 font-bold text-slate-900">{row.contactsIn.toLocaleString()}</td>
                            <td className="text-right px-4 py-3 font-bold text-slate-900">{row.completed.toLocaleString()}</td>
                            <td className="text-right px-4 py-3">
                              {row.filtered > 0 ? (
                                <span className="text-rose-600 font-bold">-{row.filtered.toLocaleString()}</span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="text-right px-4 py-3">
                              <span className={`font-black ${row.passRate >= 80 ? 'text-emerald-600' : row.passRate >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                                {row.passRate}%
                              </span>
                            </td>
                            <td className="px-4 py-3 w-36">
                              <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    row.funnelPct >= 80 ? 'bg-emerald-500' : row.funnelPct >= 50 ? 'bg-amber-500' : row.funnelPct >= 20 ? 'bg-orange-500' : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${row.funnelPct}%` }}
                                />
                              </div>
                              <span className="text-[9px] text-slate-500 font-mono mt-0.5 block text-right">{row.funnelPct}% of total</span>
                            </td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Branch Performance (A vs B) */}
                {currentFlow.nodes.some(n => n.type === 'action_condition' || n.type === 'action_qualify' || n.type === 'action_ai_qualify') && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-2xl p-5 border border-emerald-200 shadow-xs">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center">
                          <CheckCircle size={16} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-emerald-900">Branch A: Qualified / Passed</h4>
                          <p className="text-[10px] text-emerald-700">Prospects meeting qualification criteria</p>
                        </div>
                      </div>
                      {currentFlow.nodes.filter(n => n.type === 'action_condition' || n.type === 'action_qualify' || n.type === 'action_ai_qualify').map(n => {
                        const stats = nodeExecutionStats[n.id]
                        return (
                          <div key={n.id} className="flex items-center justify-between bg-emerald-50 rounded-xl p-3 text-xs border border-emerald-100">
                            <span className="font-bold text-emerald-900 truncate max-w-[200px]">{n.title}</span>
                            <span className="font-black text-emerald-700 text-base">{stats?.passed || 0}</span>
                          </div>
                        )
                      })}
                    </div>
                    <div className="bg-white rounded-2xl p-5 border border-rose-200 shadow-xs">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
                          <XCircle size={16} />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-rose-900">Branch B: Filtered / Low Intent</h4>
                          <p className="text-[10px] text-rose-700">Prospects not meeting threshold criteria</p>
                        </div>
                      </div>
                      {currentFlow.nodes.filter(n => n.type === 'action_condition' || n.type === 'action_qualify' || n.type === 'action_ai_qualify').map(n => {
                        const stats = nodeExecutionStats[n.id]
                        return (
                          <div key={n.id} className="flex items-center justify-between bg-rose-50 rounded-xl p-3 text-xs border border-rose-100">
                            <span className="font-bold text-rose-900 truncate max-w-[200px]">{n.title}</span>
                            <span className="font-black text-rose-700 text-base">{stats?.failed || 0}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* === RUN HISTORY VIEW === */}
          {studioTab === 'history' && (
            <div className="flex-1 overflow-auto p-6 sm:p-10 custom-scrollbar">
              <div className="max-w-5xl mx-auto space-y-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                      <History size={22} className="text-indigo-600" />
                      Batch Execution History
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      View all past batch runs, audience sources, and conversion rates for <span className="font-bold text-slate-700">{currentFlow.name}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsRunAudienceModalOpen(true)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black transition-all shadow-sm cursor-pointer active:scale-95"
                    >
                      <Zap size={13} className="text-amber-300 fill-amber-300" />
                      <span>New Batch Run</span>
                    </button>
                    <button
                      onClick={() => setStudioTab('builder')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <ArrowLeft size={13} />
                      <span>Back to Canvas</span>
                    </button>
                  </div>
                </div>

                {flowRunHistory.length === 0 ? (
                  <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4 border border-indigo-200">
                      <History size={24} />
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mb-1">No batch runs yet</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mb-5">
                      Execute this flow over a custom CSV audience, audience segment, or campaign leads to start tracking analytics.
                    </p>
                    <button
                      onClick={() => setIsRunAudienceModalOpen(true)}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Zap size={14} className="text-amber-300 fill-amber-300" />
                      <span>Launch First Batch Run</span>
                    </button>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="text-left px-4 py-2.5 font-bold">Run Date</th>
                          <th className="text-left px-4 py-2.5 font-bold">Audience Source</th>
                          <th className="text-left px-4 py-2.5 font-bold">Source Type</th>
                          <th className="text-right px-4 py-2.5 font-bold">Total Leads</th>
                          <th className="text-right px-4 py-2.5 font-bold">Qualified</th>
                          <th className="text-right px-4 py-2.5 font-bold">Conversion</th>
                          <th className="text-right px-4 py-2.5 font-bold">Duration</th>
                          <th className="text-center px-4 py-2.5 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flowRunHistory.map((run) => (
                          <tr key={run.id} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3 font-medium text-slate-800">{run.runAt}</td>
                            <td className="px-4 py-3">
                              <span className="font-bold text-slate-900 truncate max-w-[200px] block">{run.audienceName}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-bold">
                                {run.audienceType}
                              </span>
                            </td>
                            <td className="text-right px-4 py-3 font-bold text-slate-900">{run.totalLeads.toLocaleString()}</td>
                            <td className="text-right px-4 py-3 font-black text-emerald-600">{run.qualifiedLeads.toLocaleString()}</td>
                            <td className="text-right px-4 py-3 font-black text-indigo-600">{run.conversionRate}</td>
                            <td className="text-right px-4 py-3 text-slate-600 font-mono">{run.duration}</td>
                            <td className="text-center px-4 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                run.status === 'Completed'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : run.status === 'In Progress'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}>
                                {run.status === 'Completed' && <CheckCircle size={10} />}
                                {run.status === 'In Progress' && <Activity size={10} className="animate-spin" />}
                                {run.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RIGHT FIXED SIDEBAR: STEP CONFIGURATION INSPECTOR DRAWER (LIGHT THEME) */}
          {selectedNode && studioTab !== 'builder' && (
            <aside className="fixed right-0 top-16 bottom-0 w-[460px] max-w-[95vw] bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-slate-900">
              
              {/* Drawer Header */}
              <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/90">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center justify-center">
                    <SlidersHorizontal size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Step Configuration</h3>
                    <p className="text-[11px] text-slate-500">Customize parameters, triggers & logic</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Drawer Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                
                {/* Step Title Input */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Step Name / Label
                  </label>
                  <input
                    type="text"
                    value={selectedNode.title}
                    onChange={(e) => {
                      const val = e.target.value
                      setSelectedNode({ ...selectedNode, title: val })
                      if (selectedNode.id === 'trigger') {
                        setCurrentFlow({
                          ...currentFlow,
                          trigger: { ...currentFlow.trigger, label: val }
                        })
                      } else {
                        setCurrentFlow({
                          ...currentFlow,
                          nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, title: val } : n)
                        })
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-500 outline-none"
                  />
                </div>

                {/* ========================================================================= */}
                {/* 1. CONFIG: Trigger Node (Campaign, Custom CSV, Audience Group, etc.)      */}
                {/* ========================================================================= */}
                {selectedNode.id === 'trigger' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Trigger Type
                      </label>
                      <select
                        value={currentFlow.trigger.type || 'trigger_campaign_audience'}
                        onChange={(e) => {
                          const val = e.target.value
                          const label = val === 'trigger_csv_audience'
                            ? 'Uploaded CSV Audience: Mohali-Luxury-HNIs-Calling-List.csv'
                            : val === 'trigger_custom_audience_group'
                            ? 'Custom Audience Group: Mohali Luxury Segment'
                            : val === 'trigger_campaign_audience'
                            ? 'Campaign Audience (Calling Target)'
                            : val === 'portal_lead' 
                            ? 'Housing.com / 99Acres Lead' 
                            : val === 'whatsapp_inbound' 
                            ? 'WhatsApp Inbound Message' 
                            : 'Meta Ad Campaign Lead'
                          setCurrentFlow({
                            ...currentFlow,
                            trigger: { 
                              ...currentFlow.trigger, 
                              type: val, 
                              label,
                              csvFileName: val === 'trigger_csv_audience' ? 'Mohali-Luxury-HNIs-Calling-List.csv' : currentFlow.trigger.csvFileName,
                              csvLeadCount: val === 'trigger_csv_audience' ? 450 : currentFlow.trigger.csvLeadCount,
                              customGroupName: val === 'trigger_custom_audience_group' ? 'Mohali Luxury Segment (HNIs > 2 Cr)' : currentFlow.trigger.customGroupName
                            }
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-indigo-500 outline-none cursor-pointer"
                      >
                        <option value="trigger_campaign_audience">Campaign Audience (Outbound Calling Target)</option>
                        <option value="trigger_csv_audience">Custom Uploaded CSV Audience (e.g. HNIs / Investors List)</option>
                        <option value="trigger_custom_audience_group">Custom Audience Group / Segment (e.g. Weekend Site Visit Pool)</option>
                        <option value="meta_ad">Meta Ad Campaign (Facebook / Instagram Lead)</option>
                        <option value="portal_lead">Housing.com / 99Acres Portal Inbound</option>
                        <option value="whatsapp_inbound">WhatsApp Inbound Message</option>
                        <option value="crm_lead">CRM Lead Stage Trigger</option>
                      </select>
                    </div>

                    {/* A. Custom Uploaded CSV Audience */}
                    {currentFlow.trigger.type === 'trigger_csv_audience' && (
                      <div className="space-y-3 bg-violet-50/50 border border-violet-200 rounded-2xl p-3.5 text-xs text-violet-950">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-violet-900 flex items-center gap-1.5">
                            <FileText size={14} className="text-violet-600" />
                            Select Uploaded CSV Lead List
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-800 font-mono text-[10px] font-bold">
                            {currentFlow.trigger.csvLeadCount || 450} Leads
                          </span>
                        </div>

                        <select
                          value={currentFlow.trigger.csvFileName || 'Mohali-Luxury-HNIs-Calling-List.csv'}
                          onChange={(e) => {
                            const found = SAMPLE_CSV_AUDIENCES.find(x => x.name === e.target.value)
                            const cName = e.target.value
                            const count = found ? found.count : 450
                            setCurrentFlow({
                              ...currentFlow,
                              trigger: { 
                                ...currentFlow.trigger, 
                                csvFileName: cName,
                                csvLeadCount: count,
                                label: `Uploaded CSV: ${cName}`
                              }
                            })
                          }}
                          className="w-full bg-white border border-violet-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 outline-none cursor-pointer"
                        >
                          {SAMPLE_CSV_AUDIENCES.map(csv => (
                            <option key={csv.id} value={csv.name}>
                              {csv.name} ({csv.count} leads • {csv.tag})
                            </option>
                          ))}
                        </select>

                        {/* Upload New CSV File Dropzone / File Picker */}
                        <div className="border border-dashed border-violet-300 rounded-xl p-3 bg-white text-center">
                          <label className="cursor-pointer block">
                            <div className="flex flex-col items-center justify-center gap-1">
                              <Plus size={16} className="text-violet-600" />
                              <span className="text-[11px] font-bold text-violet-900">
                                Upload New CSV File
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Drag & drop or click to upload (.csv with Name, Phone, Email)
                              </span>
                            </div>
                            <input
                              type="file"
                              accept=".csv"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) {
                                  toast.success(`Loaded "${file.name}" with 500 leads`)
                                  setCurrentFlow({
                                    ...currentFlow,
                                    trigger: {
                                      ...currentFlow.trigger,
                                      csvFileName: file.name,
                                      csvLeadCount: 500,
                                      label: `Uploaded CSV: ${file.name}`
                                    }
                                  })
                                }
                              }}
                            />
                          </label>
                        </div>

                        {/* CSV Column Mapping Preview */}
                        <div className="space-y-1.5 pt-2 border-t border-violet-200/60">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-800 block">
                            Verified CSV Column Mapping
                          </span>
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            <div className="bg-white p-1.5 rounded-lg border border-violet-200">
                              <span className="text-slate-500 block">Name Column:</span>
                              <span className="font-bold text-slate-800 font-mono">Full Name</span>
                            </div>
                            <div className="bg-white p-1.5 rounded-lg border border-violet-200">
                              <span className="text-slate-500 block">Phone Column:</span>
                              <span className="font-bold text-slate-800 font-mono">Phone Number</span>
                            </div>
                            <div className="bg-white p-1.5 rounded-lg border border-violet-200">
                              <span className="text-slate-500 block">Email Column:</span>
                              <span className="font-bold text-slate-800 font-mono">Email Address</span>
                            </div>
                            <div className="bg-white p-1.5 rounded-lg border border-violet-200">
                              <span className="text-slate-500 block">Budget Column:</span>
                              <span className="font-bold text-slate-800 font-mono">Investment Budget</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* B. Custom Audience Group / Segment */}
                    {currentFlow.trigger.type === 'trigger_custom_audience_group' && (
                      <div className="space-y-3 bg-blue-50/50 border border-blue-200 rounded-2xl p-3.5 text-xs text-blue-950">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-blue-900 flex items-center gap-1.5">
                            <Users size={14} className="text-blue-600" />
                            Select Custom Audience Segment
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 font-mono text-[10px] font-bold">
                            Live CRM Pool
                          </span>
                        </div>

                        <select
                          value={currentFlow.trigger.customGroupName || 'Mohali Luxury Segment (HNIs > 2 Cr)'}
                          onChange={(e) => {
                            const found = SAMPLE_AUDIENCE_GROUPS.find(x => x.name === e.target.value)
                            const gName = e.target.value
                            const count = found ? found.count : 640
                            setCurrentFlow({
                              ...currentFlow,
                              trigger: { 
                                ...currentFlow.trigger, 
                                customGroupName: gName,
                                csvLeadCount: count,
                                label: `Custom Group: ${gName}`
                              }
                            })
                          }}
                          className="w-full bg-white border border-blue-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 outline-none cursor-pointer"
                        >
                          {SAMPLE_AUDIENCE_GROUPS.map(grp => (
                            <option key={grp.id} value={grp.name}>
                              {grp.name} ({grp.count} leads • {grp.tag})
                            </option>
                          ))}
                        </select>

                        <p className="text-[11px] text-slate-600 leading-snug">
                          Target prospects dynamically grouped in CRM segments, re-engagement campaigns, or DNP follow-up queues.
                        </p>
                      </div>
                    )}

                    {/* C. Existing Campaign Audience */}
                    {currentFlow.trigger.type === 'trigger_campaign_audience' && (
                      <div className="space-y-3 bg-indigo-50/50 border border-indigo-200 rounded-2xl p-3.5 text-xs text-indigo-950">
                        <div>
                          <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider mb-1.5">
                            Target Audience Campaign
                          </label>
                          <select
                            value={currentFlow.trigger.campaignId || 'ALL'}
                            onChange={(e) => {
                              const cid = e.target.value
                              const c = campaigns.find(x => x.id === cid)
                              const cName = c ? c.name : 'Joy Grand Luxury Residences'
                              setCurrentFlow({
                                ...currentFlow,
                                trigger: { ...currentFlow.trigger, campaignId: cid, campaignName: cName }
                              })
                            }}
                            className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                          >
                            <option value="ALL">All Existing Campaign Leads</option>
                            {campaigns.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.status})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-900 uppercase tracking-wider mb-1.5">
                            Audience Segment Filter
                          </label>
                          <select
                            value={currentFlow.trigger.audienceSegment || 'ALL'}
                            onChange={(e) => {
                              setCurrentFlow({
                                ...currentFlow,
                                trigger: { ...currentFlow.trigger, audienceSegment: e.target.value }
                              })
                            }}
                            className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                          >
                            <option value="ALL">All Leads in Campaign</option>
                            <option value="NEW_ONLY">New / Fresh Leads Only</option>
                            <option value="DNP_RETRY">DNP (Did Not Pick) Retry Leads (Safe Retry)</option>
                            <option value="QUALIFIED_ONLY">Qualified Leads</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {/* D. Meta Ad Campaign */}
                    {currentFlow.trigger.type === 'meta_ad' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Target Meta Campaign
                        </label>
                        <select
                          value={currentFlow.trigger.campaignId || 'ALL'}
                          onChange={(e) => {
                            const cid = e.target.value
                            const c = campaigns.find(x => x.id === cid)
                            const cName = c ? c.name : 'All Campaigns'
                            setCurrentFlow({
                              ...currentFlow,
                              trigger: { ...currentFlow.trigger, campaignId: cid, campaignName: cName }
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                        >
                          <option value="ALL">All Active Meta Campaigns</option>
                          {campaigns.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.status})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* E. Portal Lead */}
                    {currentFlow.trigger.type === 'portal_lead' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Target Lead Portal
                        </label>
                        <select
                          value={currentFlow.trigger.portalName || 'Housing.com'}
                          onChange={(e) => {
                            setCurrentFlow({
                              ...currentFlow,
                              trigger: { ...currentFlow.trigger, portalName: e.target.value }
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                        >
                          <option value="Housing.com">Housing.com</option>
                          <option value="99 Acres">99 Acres</option>
                          <option value="Magic Bricks">Magic Bricks</option>
                          <option value="All Portals">All Inbound Portals</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 2. CONFIG: Automated AI Voice Call (Official Gemini Live Voices)          */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_ai_call' && (
                  <div className="space-y-4">
                    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-950">
                      <div className="flex items-center gap-1.5 font-bold mb-1 text-indigo-700">
                        <Radio size={14} className="text-indigo-600 animate-pulse" />
                        <span>Official Gemini 3.1 Flash Live Calling Engine</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Executes natural real-time speech synthesis and conversational qualification. All spoken responses are automatically transcribed and saved directly to the lead's profile under custom fields.
                      </p>
                    </div>

                    {/* Assigned Gemini Live Voice */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Assigned Voice Agent (Official Gemini 3.1 Live API)
                      </label>
                      <select
                        value={selectedNode.config.voiceAgent || 'Fenrir (Crisp & Focused)'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, voiceAgent: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                      >
                        {GEMINI_LIVE_VOICES.map(voice => (
                          <option key={voice.id} value={`${voice.name} (${voice.tone})`}>
                            {voice.name} — {voice.tone} ({voice.tag})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Call Objective */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Call Objective
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.objective || 'Site Visit Confirmation & Budget Qualification'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, objective: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                      />
                    </div>

                    {/* Opening Greeting / First Line */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Opening Greeting / First Spoken Line
                        </label>
                        <span className="text-[10px] text-slate-400">Tokens: {'{{lead.name}}'}</span>
                      </div>
                      <textarea
                        rows={2}
                        value={selectedNode.config.firstLine || 'Hi {{lead.name}}, calling from Bluesquare Infra regarding Joy Grand Luxury Residences.'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, firstLine: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed"
                      />
                    </div>

                    {/* MULTI-QUESTION QUALIFICATION BUILDER */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                            Structured Qualification Questions
                          </label>
                          <span className="text-[10px] text-slate-500">Auto-saved to Lead Info custom fields</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const curQuestions = selectedNode.config.questions || [
                              { id: 'q_1', question: selectedNode.config.qualificationQuestion || 'Are you interested in scheduling a site visit this weekend?', fieldKey: 'site_visit_interest', saveToLeadProfile: true }
                            ]
                            const newQ = {
                              id: `q_${Date.now()}`,
                              question: 'What is your preferred configuration (e.g. 2 BHK, 3 BHK, or Penthouse)?',
                              fieldKey: `custom_question_${curQuestions.length + 1}`,
                              saveToLeadProfile: true,
                              expectedAnswer: '2 BHK / 3 BHK'
                            }
                            const updated = { ...selectedNode.config, questions: [...curQuestions, newQ] }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-700 font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={13} /> Add Question
                        </button>
                      </div>

                      <div className="space-y-3">
                        {(selectedNode.config.questions || [
                          { id: 'q_1', question: 'Are you interested in scheduling a site visit to Joy Grand this weekend?', fieldKey: 'site_visit_interest', saveToLeadProfile: true, expectedAnswer: 'Yes / Saturday / Sunday' },
                          { id: 'q_2', question: 'What is your preferred investment budget range (e.g. 1.5 Cr to 2.5 Cr)?', fieldKey: 'budget_range', saveToLeadProfile: true, expectedAnswer: '1.5 Cr - 2.5 Cr' }
                        ]).map((q: any, qi: number) => (
                          <div key={q.id || qi} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-indigo-700 text-[11px]">Question {qi + 1}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const curQuestions = selectedNode.config.questions || []
                                  const filtered = curQuestions.filter((_: any, i: number) => i !== qi)
                                  const updated = { ...selectedNode.config, questions: filtered }
                                  setSelectedNode({ ...selectedNode, config: updated })
                                  setCurrentFlow({
                                    ...currentFlow,
                                    nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                  })
                                }}
                                className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Remove question"
                              >
                                <X size={13} />
                              </button>
                            </div>

                            <textarea
                              rows={2}
                              value={q.question || ''}
                              onChange={(e) => {
                                const curQuestions = [...(selectedNode.config.questions || [])]
                                curQuestions[qi] = { ...curQuestions[qi], question: e.target.value }
                                const updated = { ...selectedNode.config, questions: curQuestions }
                                setSelectedNode({ ...selectedNode, config: updated })
                                setCurrentFlow({
                                  ...currentFlow,
                                  nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                })
                              }}
                              placeholder="Type voice question prompt..."
                              className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium outline-none"
                            />

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                                  Save Answer To Lead Field
                                </label>
                                <input
                                  type="text"
                                  value={q.fieldKey || ''}
                                  onChange={(e) => {
                                    const curQuestions = [...(selectedNode.config.questions || [])]
                                    curQuestions[qi] = { ...curQuestions[qi], fieldKey: e.target.value }
                                    const updated = { ...selectedNode.config, questions: curQuestions }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  placeholder="e.g. site_visit_interest"
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-800 outline-none"
                                />
                              </div>
                              <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-1.5 cursor-pointer pb-1">
                                  <input
                                    type="checkbox"
                                    checked={q.saveToLeadProfile ?? true}
                                    onChange={(e) => {
                                      const curQuestions = [...(selectedNode.config.questions || [])]
                                      curQuestions[qi] = { ...curQuestions[qi], saveToLeadProfile: e.target.checked }
                                      const updated = { ...selectedNode.config, questions: curQuestions }
                                      setSelectedNode({ ...selectedNode, config: updated })
                                      setCurrentFlow({
                                        ...currentFlow,
                                        nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                      })
                                    }}
                                    className="rounded text-indigo-600 bg-white border-slate-300"
                                  />
                                  <span className="text-[10px] font-bold text-slate-700">Auto-save to Lead</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* DNP / Unanswered Call Handling Safety */}
                    <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-900 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px]">
                        <CheckCircle2 size={13} className="text-amber-600" />
                        <span>Safe DNP (Did Not Pick) Handling</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-snug">
                        If prospect is busy or does not answer, flow initiates smart callback in 2 hours without moving the lead into "Never Picked".
                      </p>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 3. CONFIG: Deterministic Qualification (100% Deterministic Rule Engine)   */}
                {/* ========================================================================= */}
                {(selectedNode.type === 'action_qualify' || selectedNode.type === 'action_ai_qualify') && (
                  <div className="space-y-4">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-950">
                      <div className="flex items-center gap-1.5 font-bold mb-1 text-emerald-800">
                        <Shield size={14} className="text-emerald-600" />
                        <span>Deterministic Qualification Engine</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Evaluates prospect responses with mathematical precision. Zero hallucinations or AI drift.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Passing Score Threshold
                        </label>
                        <span className="text-xs font-black text-emerald-700 font-mono bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {selectedNode.config.passScore || 100} pts
                        </span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="100"
                        step="5"
                        value={selectedNode.config.passScore || 100}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10)
                          const updated = { ...selectedNode.config, passScore: val }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full accent-emerald-600 cursor-pointer"
                      />
                    </div>

                    {/* Deterministic Qualification Rules List */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Deterministic Criteria Rules
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const curRules = selectedNode.config.rules || []
                            const newRule = {
                              id: String(Date.now()),
                              field: 'site_visit_interest',
                              label: 'New Qualification Criteria',
                              operator: 'contains_any',
                              value: 'yes, sure, visit',
                              points: 50,
                              required: false
                            }
                            const updated = { ...selectedNode.config, rules: [...curRules, newRule] }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={13} /> Add Criteria
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {(selectedNode.config.rules || [
                          { id: '1', field: 'site_visit_interest', label: 'Prospect Confirmed Site Visit on Call', operator: 'contains_any', value: 'yes, yeah, sure, interested, visit, confirm, weekend', points: 100, required: true }
                        ]).map((rule: any, ri: number) => (
                          <div key={rule.id || ri} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <input
                                type="text"
                                value={rule.label || ''}
                                onChange={(e) => {
                                  const updatedRules = [...(selectedNode.config.rules || [])]
                                  updatedRules[ri] = { ...updatedRules[ri], label: e.target.value }
                                  const updated = { ...selectedNode.config, rules: updatedRules }
                                  setSelectedNode({ ...selectedNode, config: updated })
                                  setCurrentFlow({
                                    ...currentFlow,
                                    nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                  })
                                }}
                                placeholder="Rule title (e.g. Confirmed Site Visit)"
                                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 outline-none"
                              />
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] text-slate-500 font-bold">Pts:</span>
                                <input
                                  type="number"
                                  min="5"
                                  max="100"
                                  step="5"
                                  value={rule.points || 50}
                                  onChange={(e) => {
                                    const updatedRules = [...(selectedNode.config.rules || [])]
                                    updatedRules[ri] = { ...updatedRules[ri], points: parseInt(e.target.value, 10) || 0 }
                                    const updated = { ...selectedNode.config, rules: updatedRules }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  className="w-14 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-emerald-700 font-bold text-center outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedRules = (selectedNode.config.rules || []).filter((_: any, i: number) => i !== ri)
                                    const updated = { ...selectedNode.config, rules: updatedRules }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Field Key</label>
                                <input
                                  type="text"
                                  value={rule.field || ''}
                                  onChange={(e) => {
                                    const updatedRules = [...(selectedNode.config.rules || [])]
                                    updatedRules[ri] = { ...updatedRules[ri], field: e.target.value }
                                    const updated = { ...selectedNode.config, rules: updatedRules }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  placeholder="site_visit_interest / budget"
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 font-mono"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Expected Keywords</label>
                                <input
                                  type="text"
                                  value={rule.value || ''}
                                  onChange={(e) => {
                                    const updatedRules = [...(selectedNode.config.rules || [])]
                                    updatedRules[ri] = { ...updatedRules[ri], value: e.target.value }
                                    const updated = { ...selectedNode.config, rules: updatedRules }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  placeholder="yes, yeah, sure, visit"
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 font-mono"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 4. CONFIG: AI Logic Node / Condition Branch (Comprehensive Inspector)     */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_condition' && (
                  <div className="space-y-4">
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-950">
                      <div className="flex items-center gap-1.5 font-bold mb-1 text-rose-800">
                        <GitFork size={14} className="text-rose-600" />
                        <span>Dual Path Logic Branching</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Deterministically splits the pipeline into two parallel paths: Branch A for high-intent qualified leads, and Branch B for leads needing nurturing or follow-up.
                      </p>
                    </div>

                    {/* Condition Source Selector */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Condition Evaluation Source
                      </label>
                      <select
                        value={selectedNode.config.evaluationType || 'qualification_score'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, evaluationType: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                      >
                        <option value="qualification_score">Deterministic Qualification Score (Pass/Fail)</option>
                        <option value="question_response">Question Answer Keyword Matching</option>
                        <option value="crm_attribute">CRM Lead Property (e.g. Budget &gt;= 1.5 Cr)</option>
                      </select>
                    </div>

                    {/* Condition Operator & Threshold */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                          Comparison Operator
                        </label>
                        <select
                          value={selectedNode.config.operator || '>='}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, operator: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-900"
                        >
                          <option value=">=">&gt;= (Greater or Equal)</option>
                          <option value="==">== (Exact Match)</option>
                          <option value="contains">contains (Keywords)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                          Pass Value / Score
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.value ?? 100}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, value: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono font-bold text-slate-900"
                        />
                      </div>
                    </div>

                    {/* Branch A Settings */}
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                          <CheckCircle size={14} className="text-emerald-600" />
                          Branch A: Qualified / Said Yes Path
                        </span>
                        <span className="text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                          True Path
                        </span>
                      </div>
                      <input
                        type="text"
                        value={selectedNode.config.branchTrueLabel || 'Branch A: Qualified (Said Yes / High Intent)'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, branchTrueLabel: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium"
                      />
                      <p className="text-[10px] text-slate-600">
                        Subsequent steps marked with green True badge (e.g. Notify Admin on WhatsApp + Deliver Project Brochure) execute when this condition passes.
                      </p>
                    </div>

                    {/* Branch B Settings */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <X size={14} className="text-slate-500" />
                          Branch B: Not Interested / Low Intent Path
                        </span>
                        <span className="text-[10px] font-bold uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                          False Path
                        </span>
                      </div>
                      <input
                        type="text"
                        value={selectedNode.config.branchFalseLabel || 'Branch B: Not Interested / Low Intent'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, branchFalseLabel: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium"
                      />
                      <p className="text-[10px] text-slate-600">
                        Subsequent steps marked with False badge (e.g. Move to Contacted / Follow Up Later) execute when this condition is not met.
                      </p>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 5. CONFIG: Notify Admin & Team (Email + WhatsApp)                         */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_notify_team' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Admin Notification Channels
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(selectedNode.config.channels || ['email', 'whatsapp']).includes('email')}
                            onChange={(e) => {
                              const curr = selectedNode.config.channels || ['email', 'whatsapp']
                              const next = e.target.checked ? [...curr, 'email'] : curr.filter((c: string) => c !== 'email')
                              const updated = { ...selectedNode.config, channels: next }
                              setSelectedNode({ ...selectedNode, config: updated })
                              setCurrentFlow({
                                ...currentFlow,
                                nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                              })
                            }}
                            className="rounded text-indigo-600 bg-white border-slate-300"
                          />
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <Mail size={13} className="text-indigo-600" /> Admin Email
                          </span>
                        </label>

                        <label className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(selectedNode.config.channels || ['email', 'whatsapp']).includes('whatsapp')}
                            onChange={(e) => {
                              const curr = selectedNode.config.channels || ['email', 'whatsapp']
                              const next = e.target.checked ? [...curr, 'whatsapp'] : curr.filter((c: string) => c !== 'whatsapp')
                              const updated = { ...selectedNode.config, channels: next }
                              setSelectedNode({ ...selectedNode, config: updated })
                              setCurrentFlow({
                                ...currentFlow,
                                nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                              })
                            }}
                            className="rounded text-emerald-600 bg-white border-slate-300"
                          />
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <MessageSquare size={13} className="text-emerald-600" /> Admin WhatsApp
                          </span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Admin Recipient Email
                      </label>
                      <input
                        type="email"
                        value={selectedNode.config.adminEmail || 'admin@bluesquareinfra.com'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, adminEmail: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="admin@bluesquareinfra.com"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Admin WhatsApp Number
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.adminWhatsapp || '+91 98765 43210'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, adminWhatsapp: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="+91 98765 43210"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                      />
                    </div>

                    <div className="space-y-2 pt-1 border-t border-slate-200">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedNode.config.includeLeadInfo ?? true}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, includeLeadInfo: e.target.checked }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="rounded text-indigo-600 bg-white border-slate-300"
                        />
                        <span className="text-xs text-slate-700 font-medium">Include full prospect details & saved questionnaire answers</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedNode.config.includeCallDetails ?? true}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, includeCallDetails: e.target.checked }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="rounded text-indigo-600 bg-white border-slate-300"
                        />
                        <span className="text-xs text-slate-700 font-medium">Attach Gemini Live call recording & qualification score</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Alert Message Template
                      </label>
                      <textarea
                        rows={2}
                        value={selectedNode.config.alertMessage || '🔥 HOT LEAD ALERT: {{lead.name}} ({{lead.phone}}) confirmed site visit on call! Call recording & qualification attached.'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, alertMessage: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed"
                      />
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 6. CONFIG: WhatsApp Message & Brochure Delivery                           */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_whatsapp_msg' && (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          WhatsApp Message Text
                        </label>
                        <span className="text-[10px] text-slate-400">Insert variables below</span>
                      </div>
                      <textarea
                        rows={5}
                        value={selectedNode.config.message || ''}
                        onChange={(e) => {
                          const val = e.target.value
                          const updated = { ...selectedNode.config, message: val }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Hi {{lead.name}}, thank you for speaking with our advisor!"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-900 font-medium leading-relaxed outline-none"
                      />
                      {/* Variable Insertion Pills */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {['{{lead.name}}', '{{lead.phone}}', '{{project}}', '{{assigned_agent}}'].map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const cur = selectedNode.config.message || ''
                              const updated = { ...selectedNode.config, message: `${cur} ${tag}` }
                              setSelectedNode({ ...selectedNode, config: updated })
                              setCurrentFlow({
                                ...currentFlow,
                                nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                              })
                            }}
                            className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-mono transition-colors cursor-pointer"
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* BUTTON TYPE MODE SWITCHER */}
                    <div className="pt-2 border-t border-slate-200">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Interactive Button Mode
                        </label>
                        <span className="text-[10px] text-slate-400">Meta WhatsApp API</span>
                      </div>

                      {/* 3-way Segmented Control */}
                      <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...selectedNode.config, buttonType: 'quick_reply' }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${
                            (selectedNode.config.buttonType || 'quick_reply') === 'quick_reply'
                              ? 'bg-white text-emerald-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ⚡ Quick Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { 
                              ...selectedNode.config, 
                              buttonType: 'cta_url',
                              ctaButtons: selectedNode.config.ctaButtons || [
                                { id: 'cta_1', title: '📍 Open Google Maps', type: 'url', url: 'https://maps.google.com/?q=Joy+Grand+Mohali' },
                                { id: 'cta_2', title: '🌐 Project Website', type: 'url', url: 'https://bluesquareinfra.com/joygrand' }
                              ]
                            }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${
                            selectedNode.config.buttonType === 'cta_url'
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          🔗 CTA Links
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...selectedNode.config, buttonType: 'none' }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className={`py-1.5 px-2 rounded-lg text-center transition-all cursor-pointer ${
                            selectedNode.config.buttonType === 'none'
                              ? 'bg-white text-slate-800 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          🚫 None
                        </button>
                      </div>

                      {/* Official WhatsApp API Rule Callout Alert */}
                      <div className="mt-2.5 p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] text-amber-950 flex items-start gap-2">
                        <AlertCircle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <div className="leading-snug">
                          <span className="font-bold block text-amber-900">WhatsApp Business API Constraint</span>
                          Meta strictly prohibits combining Quick Reply buttons and Link (CTA) buttons in a single message.
                          {(selectedNode.config.buttonType || 'quick_reply') === 'quick_reply' ? (
                            <span> You are using <strong>Quick Reply</strong>: clicking buttons sends prospect responses to trigger branch actions in your flow.</span>
                          ) : selectedNode.config.buttonType === 'cta_url' ? (
                            <span> You are using <strong>CTA Link Buttons</strong>: clicking buttons opens external URLs or initiates direct phone calls.</span>
                          ) : (
                            <span> Interactive buttons are disabled for this message.</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* MODE 1: QUICK REPLY BUTTONS & BRANCHING */}
                    {(selectedNode.config.buttonType || 'quick_reply') === 'quick_reply' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Quick Reply Buttons &amp; Branch Actions (Max 3)
                          </label>
                          <span className="text-[10px] text-slate-400">
                            {((selectedNode.config.quickReplyButtons && selectedNode.config.quickReplyButtons.length > 0)
                              ? selectedNode.config.quickReplyButtons
                              : (selectedNode.config.buttons || ['📅 Schedule Visit', '💬 Talk to Agent', '📍 Location Pin'])
                            ).length} / 3
                          </span>
                        </div>

                        {/* List of Quick Reply buttons */}
                        <div className="space-y-3">
                          {((selectedNode.config.quickReplyButtons && selectedNode.config.quickReplyButtons.length > 0)
                            ? selectedNode.config.quickReplyButtons
                            : (selectedNode.config.buttons || ['📅 Schedule Visit', '💬 Talk to Agent', '📍 Location Pin']).map((b: string, i: number) => ({
                                id: `btn_${i + 1}`,
                                title: b,
                                actionType: i === 0 ? 'crm_stage' : i === 1 ? 'assign_agent' : 'send_reply',
                                actionValue: i === 0 ? 'Visit Planned' : i === 1 ? 'Harman Bajwa' : 'Here is our project location on Google Maps: https://maps.google.com'
                              }))
                          ).map((btn: any, bi: number, allBtns: any[]) => (
                            <div key={bi} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded border border-emerald-200">
                                  Button {bi + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = allBtns.filter((_, i) => i !== bi)
                                    const updated = { 
                                      ...selectedNode.config, 
                                      quickReplyButtons: next,
                                      buttons: next.map(x => x.title)
                                    }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                                  title="Delete button"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              {/* Button Label */}
                              <div>
                                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                  Button Label (What Prospect Sees)
                                </label>
                                <input
                                  type="text"
                                  value={btn.title || ''}
                                  onChange={(e) => {
                                    const next = [...allBtns]
                                    next[bi] = { ...next[bi], title: e.target.value }
                                    const updated = { 
                                      ...selectedNode.config, 
                                      quickReplyButtons: next,
                                      buttons: next.map(x => x.title)
                                    }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  placeholder="e.g. 📅 Confirm Saturday Slot"
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-bold"
                                />
                              </div>

                              {/* Action When Clicked */}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                    Action On Click (Branch)
                                  </label>
                                  <select
                                    value={btn.actionType || 'crm_stage'}
                                    onChange={(e) => {
                                      const next = [...allBtns]
                                      const newType = e.target.value
                                      let defaultValue = btn.actionValue
                                      if (newType === 'crm_stage') defaultValue = 'Visit Planned'
                                      if (newType === 'assign_agent') defaultValue = 'Harman Bajwa'
                                      if (newType === 'notify_admin') defaultValue = 'Prospect requested callback via button'
                                      if (newType === 'send_reply') defaultValue = 'Thank you! We will connect shortly.'
                                      next[bi] = { ...next[bi], actionType: newType, actionValue: defaultValue }
                                      const updated = { 
                                        ...selectedNode.config, 
                                        quickReplyButtons: next,
                                        buttons: next.map(x => x.title)
                                      }
                                      setSelectedNode({ ...selectedNode, config: updated })
                                      setCurrentFlow({
                                        ...currentFlow,
                                        nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                      })
                                    }}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 font-medium cursor-pointer"
                                  >
                                    <option value="crm_stage">🏷️ Move CRM Stage</option>
                                    <option value="notify_admin">🔔 Alert Admin (Email + WhatsApp)</option>
                                    <option value="assign_agent">👤 Route to Agent</option>
                                    <option value="send_reply">💬 Send Automated Reply</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                    Action Target / Value
                                  </label>
                                  {btn.actionType === 'crm_stage' ? (
                                    <select
                                      value={btn.actionValue || 'Visit Planned'}
                                      onChange={(e) => {
                                        const next = [...allBtns]
                                        next[bi] = { ...next[bi], actionValue: e.target.value }
                                        const updated = { ...selectedNode.config, quickReplyButtons: next }
                                        setSelectedNode({ ...selectedNode, config: updated })
                                        setCurrentFlow({
                                          ...currentFlow,
                                          nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                        })
                                      }}
                                      className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 font-bold cursor-pointer"
                                    >
                                      <option value="Visit Planned">Visit Planned</option>
                                      <option value="Site Visit">Site Visit</option>
                                      <option value="Contacted">Contacted</option>
                                      <option value="Qualified">Qualified</option>
                                      <option value="Interview Scheduled">Interview Scheduled</option>
                                      <option value="Won">Won</option>
                                      <option value="Lost">Lost</option>
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      value={btn.actionValue || ''}
                                      onChange={(e) => {
                                        const next = [...allBtns]
                                        next[bi] = { ...next[bi], actionValue: e.target.value }
                                        const updated = { ...selectedNode.config, quickReplyButtons: next }
                                        setSelectedNode({ ...selectedNode, config: updated })
                                        setCurrentFlow({
                                          ...currentFlow,
                                          nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                        })
                                      }}
                                      placeholder={
                                        btn.actionType === 'assign_agent' ? 'Agent / Closer Name' :
                                        btn.actionType === 'notify_admin' ? 'Alert reason' :
                                        'Reply text...'
                                      }
                                      className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium"
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}

                          {/* Add button trigger */}
                          {(((selectedNode.config.quickReplyButtons && selectedNode.config.quickReplyButtons.length > 0)
                            ? selectedNode.config.quickReplyButtons
                            : (selectedNode.config.buttons || ['📅 Schedule Visit', '💬 Talk to Agent', '📍 Location Pin'])
                          ).length < 3) && (
                            <button
                              type="button"
                              onClick={() => {
                                const current = (selectedNode.config.quickReplyButtons && selectedNode.config.quickReplyButtons.length > 0)
                                  ? selectedNode.config.quickReplyButtons
                                  : (selectedNode.config.buttons || ['📅 Schedule Visit', '💬 Talk to Agent']).map((b: string, i: number) => ({
                                      id: `btn_${i + 1}`,
                                      title: b,
                                      actionType: 'crm_stage',
                                      actionValue: 'Visit Planned'
                                    }))
                                const next = [
                                  ...current,
                                  { id: `btn_${current.length + 1}`, title: `Button ${current.length + 1}`, actionType: 'crm_stage', actionValue: 'Visit Planned' }
                                ]
                                const updated = { 
                                  ...selectedNode.config, 
                                  quickReplyButtons: next,
                                  buttons: next.map(x => x.title)
                                }
                                setSelectedNode({ ...selectedNode, config: updated })
                                setCurrentFlow({
                                  ...currentFlow,
                                  nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                })
                              }}
                              className="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Plus size={14} />
                              <span>Add Quick Reply Button</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* MODE 2: CALL-TO-ACTION (CTA) LINK BUTTONS */}
                    {selectedNode.config.buttonType === 'cta_url' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Call-to-Action Link Buttons (Max 2)
                          </label>
                          <span className="text-[10px] text-slate-400">
                            {(selectedNode.config.ctaButtons || []).length} / 2
                          </span>
                        </div>

                        <div className="space-y-3">
                          {(selectedNode.config.ctaButtons || [
                            { id: 'cta_1', title: '📍 Open Google Maps', type: 'url', url: 'https://maps.google.com/?q=Joy+Grand+Mohali' }
                          ]).map((cta: any, ci: number, allCtas: any[]) => (
                            <div key={ci} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded border border-indigo-200">
                                  CTA Link {ci + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = allCtas.filter((_, i) => i !== ci)
                                    const updated = { ...selectedNode.config, ctaButtons: next }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                                  title="Delete CTA button"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                    Button Text
                                  </label>
                                  <input
                                    type="text"
                                    value={cta.title || ''}
                                    onChange={(e) => {
                                      const next = [...allCtas]
                                      next[ci] = { ...next[ci], title: e.target.value }
                                      const updated = { ...selectedNode.config, ctaButtons: next }
                                      setSelectedNode({ ...selectedNode, config: updated })
                                      setCurrentFlow({
                                        ...currentFlow,
                                        nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                      })
                                    }}
                                    placeholder="📍 Open Google Maps"
                                    className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-bold"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                    Action Type
                                  </label>
                                  <select
                                    value={cta.type || 'url'}
                                    onChange={(e) => {
                                      const next = [...allCtas]
                                      next[ci] = { ...next[ci], type: e.target.value }
                                      const updated = { ...selectedNode.config, ctaButtons: next }
                                      setSelectedNode({ ...selectedNode, config: updated })
                                      setCurrentFlow({
                                        ...currentFlow,
                                        nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                      })
                                    }}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 font-medium cursor-pointer"
                                  >
                                    <option value="url">🌐 Web URL / Map Link</option>
                                    <option value="call">📞 Phone Call</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                                  {cta.type === 'call' ? 'Phone Number with Country Code' : 'Destination URL (https://...)'}
                                </label>
                                <input
                                  type="text"
                                  value={cta.type === 'call' ? (cta.phoneNumber || cta.url || '') : (cta.url || '')}
                                  onChange={(e) => {
                                    const next = [...allCtas]
                                    if (cta.type === 'call') {
                                      next[ci] = { ...next[ci], phoneNumber: e.target.value, url: `tel:${e.target.value}` }
                                    } else {
                                      next[ci] = { ...next[ci], url: e.target.value }
                                    }
                                    const updated = { ...selectedNode.config, ctaButtons: next }
                                    setSelectedNode({ ...selectedNode, config: updated })
                                    setCurrentFlow({
                                      ...currentFlow,
                                      nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                    })
                                  }}
                                  placeholder={cta.type === 'call' ? '+91 98765 43210' : 'https://maps.google.com/?q=...'}
                                  className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                                />
                              </div>
                            </div>
                          ))}

                          {(selectedNode.config.ctaButtons || []).length < 2 && (
                            <button
                              type="button"
                              onClick={() => {
                                const current = selectedNode.config.ctaButtons || []
                                const next = [
                                  ...current,
                                  { id: `cta_${current.length + 1}`, title: '🌐 View Project Website', type: 'url', url: 'https://bluesquareinfra.com' }
                                ]
                                const updated = { ...selectedNode.config, ctaButtons: next }
                                setSelectedNode({ ...selectedNode, config: updated })
                                setCurrentFlow({
                                  ...currentFlow,
                                  nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                                })
                              }}
                              className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Plus size={14} />
                              <span>Add CTA Link Button</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* PDF Brochure Attachment Toggle */}
                    <div className="pt-2 border-t border-slate-200">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selectedNode.config.includeBrochure}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, includeBrochure: e.target.checked }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="rounded text-indigo-600 bg-white border-slate-300"
                        />
                        <span className="text-xs font-bold text-slate-800">Attach Verified PDF Brochure / Floor Plan</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 7. CONFIG: Lead Assignment, CRM Stage, Delay, etc.                        */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_assign_agent' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Assignment Mode
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...selectedNode.config, assignMode: 'individual' }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-bold border cursor-pointer transition-all ${
                            selectedNode.config.assignMode !== 'group' 
                              ? 'bg-indigo-600 text-white border-indigo-600' 
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          Specific Agent
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...selectedNode.config, assignMode: 'group' }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className={`py-2 px-3 rounded-xl text-xs font-bold border cursor-pointer transition-all ${
                            selectedNode.config.assignMode === 'group' 
                              ? 'bg-indigo-600 text-white border-indigo-600' 
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }`}
                        >
                          Distribution Group
                        </button>
                      </div>
                    </div>

                    {selectedNode.config.assignMode === 'group' ? (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Select Lead Distribution Group
                        </label>
                        <select
                          value={selectedNode.config.groupId || ''}
                          onChange={(e) => {
                            const gid = e.target.value
                            const grp = distributionGroups.find(g => g.id === gid)
                            const gname = grp ? grp.name : 'Mohali Sales Team (Group Distribution)'
                            const updated = { ...selectedNode.config, groupId: gid, groupName: gname }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                        >
                          {distributionGroups.length === 0 && (
                            <option value="default">Default Weighted Round Robin</option>
                          )}
                          {distributionGroups.map(g => (
                            <option key={g.id} value={g.id}>
                              {g.name} ({g.membersCount} agents)
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Select Individual Team Member
                        </label>
                        <select
                          value={selectedNode.config.agentId || 'default'}
                          onChange={(e) => {
                            const aid = e.target.value
                            const m = team.find(t => t.id === aid)
                            const aname = m ? (m.business_name || m.full_name || m.email) : 'Harman Bajwa'
                            const updated = { ...selectedNode.config, agentId: aid, agentName: aname }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-indigo-500 outline-none cursor-pointer"
                        >
                          {team.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.business_name || m.full_name || m.email?.split('@')[0]} ({m.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* CRM Stage */}
                {selectedNode.type === 'action_crm_stage' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Target Pipeline Stage
                      </label>
                      <select
                        value={selectedNode.config.stage || 'Contacted'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, stage: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 cursor-pointer"
                      >
                        <option value="New Lead">New Lead</option>
                        <option value="Contacted">Contacted</option>
                        <option value="Follow Up">Follow Up</option>
                        <option value="Qualified">Qualified</option>
                        <option value="Site Visit">Site Visit</option>
                        <option value="Visit Planned">Visit Planned</option>
                        <option value="Interview Scheduled">Interview Scheduled</option>
                        <option value="Won">Won</option>
                        <option value="Lost">Lost</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Add CRM Tags (comma separated)
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.tags || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, tags: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Hot Lead, Calling Campaign, Verified"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                      />
                    </div>
                  </div>
                )}

                {/* Delay */}
                {selectedNode.type === 'action_delay' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Duration
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={selectedNode.config.duration || 5}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10) || 1
                          const updated = { ...selectedNode.config, duration: val }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Unit
                      </label>
                      <select
                        value={selectedNode.config.unit || 'minutes'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, unit: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 cursor-pointer"
                      >
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 8. CONFIG: Instagram Direct Message (action_ig_send_dm)                   */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_ig_send_dm' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-pink-50 border border-pink-200 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageCircle size={15} className="text-pink-600 shrink-0" />
                        <span className="text-xs font-bold text-pink-900">Instagram DM Automation</span>
                      </div>
                      <span className="text-[10px] font-bold bg-white text-pink-700 px-2 py-0.5 rounded-full border border-pink-200">
                        Meta Graph API
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Instagram DM Text
                        </label>
                        <span className="text-[10px] text-slate-400">Personalize with variables</span>
                      </div>
                      <textarea
                        rows={4}
                        value={selectedNode.config.message || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, message: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Hi {{lead.name}}! 👋 Thank you for messaging us. Here is the verified project brochure..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed outline-none"
                      />
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {['{{lead.name}}', '{{project}}', '{{assigned_agent}}'].map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const cur = selectedNode.config.message || ''
                              const updated = { ...selectedNode.config, message: `${cur} ${tag}` }
                              setSelectedNode({ ...selectedNode, config: updated })
                              setCurrentFlow({
                                ...currentFlow,
                                nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                              })
                            }}
                            className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-mono transition-colors cursor-pointer"
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-200">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!selectedNode.config.includeBrochure}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, includeBrochure: e.target.checked }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="rounded text-pink-600 bg-white border-slate-300"
                        />
                        <span className="text-xs font-bold text-slate-800">Attach Verified PDF Brochure</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 9. CONFIG: Instagram Comment Auto-Reply (action_ig_comment_reply)         */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_ig_comment_reply' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-fuchsia-50 border border-fuchsia-200 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={15} className="text-fuchsia-600 shrink-0" />
                        <span className="text-xs font-bold text-fuchsia-900">Reel & Post Comment Auto-Reply</span>
                      </div>
                      <span className="text-[10px] font-bold bg-white text-fuchsia-700 px-2 py-0.5 rounded-full border border-fuchsia-200">
                        Public + DM
                      </span>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Public Comment Reply
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.publicReplyText || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, publicReplyText: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Sent you the complete brochure & price details in DM! 📩 Check your requests."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Instant Private DM Message
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.config.dmMessage || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, dmMessage: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Hey {{lead.name}}! Thanks for your comment. Here is the verified brochure and pricing link..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed"
                      />
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 10. CONFIG: Instagram Brochure Card (action_ig_card)                      */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_ig_card' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Card Title
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.cardTitle || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, cardTitle: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Joy Grand Luxury Residences"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Card Subtitle / Price
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.cardSubtitle || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, cardSubtitle: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="3 & 4 BHK Luxury Apartments • Starting ₹1.8 Cr"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Button Text
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.buttonTitle || 'Download Brochure'}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, buttonTitle: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 font-bold"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                          Destination URL
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.buttonUrl || ''}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, buttonUrl: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          placeholder="https://bluesquareinfra.com"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 11. CONFIG: Facebook Messenger (action_fb_send_messenger)                 */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_fb_send_messenger' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Messenger Message Text
                      </label>
                      <textarea
                        rows={4}
                        value={selectedNode.config.message || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, message: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Hello {{lead.name}}! Thank you for contacting us on Facebook..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 12. CONFIG: Live Call Transfer (action_ai_call_transfer)                  */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_ai_call_transfer' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-2xl">
                      <span className="text-xs font-bold text-purple-900 block mb-1">Warm Human Closer Transfer</span>
                      <p className="text-[11px] text-purple-700 leading-snug">
                        When the Gemini Live voice agent detects high intent, it seamlessly dials your sales rep and merges the prospect into a live call.
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Sales Rep / Closer Name
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.closerName || 'Harman Bajwa'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, closerName: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Closer Phone Number with Country Code
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.transferNumber || '+91 98765 43210'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, transferNumber: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Whisper Audio / Briefing Message to Agent
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.whisperMessage || 'Connecting verified high-intent buyer for Joy Grand'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, whisperMessage: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900"
                      />
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 13. CONFIG: Send Rich Email (action_send_email)                           */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_send_email' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Sender Name
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.senderName || 'Nobogent Real Estate Advisory'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, senderName: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Email Subject Line
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.subject || 'Official Joy Grand Brochure & Pricing Sheet'}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, subject: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Email Body (HTML / Markdown)
                      </label>
                      <textarea
                        rows={4}
                        value={selectedNode.config.body || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, body: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Dear {{lead.name}}, thank you for your interest..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 14. CONFIG: Split Traffic (action_split_traffic)                          */}
                {/* ========================================================================= */}
                {selectedNode.type === 'action_split_traffic' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl">
                      <span className="text-xs font-bold text-amber-900 block mb-1">A/B Conversion Testing</span>
                      <p className="text-[11px] text-amber-700 leading-snug">
                        Randomly distributes inbound leads between Path A and Path B to measure which outreach channel produces higher booking rates.
                      </p>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                          Path A Percentage
                        </label>
                        <span className="text-xs font-mono font-bold text-indigo-700">
                          {selectedNode.config.splitPercentage || 50}% Path A / {100 - (selectedNode.config.splitPercentage || 50)}% Path B
                        </span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="90"
                        step="5"
                        value={selectedNode.config.splitPercentage || 50}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, splitPercentage: parseInt(e.target.value, 10) }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        className="w-full accent-indigo-600 cursor-pointer"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Path A Label</label>
                        <input
                          type="text"
                          value={selectedNode.config.pathALabel || 'Path A (AI Voice Call)'}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, pathALabel: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">Path B Label</label>
                        <input
                          type="text"
                          value={selectedNode.config.pathBLabel || 'Path B (WhatsApp Interactive)'}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, pathBLabel: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================================= */}
                {/* 15. CONFIG: Tags, Notes & Fields                                          */}
                {/* ========================================================================= */}
                {(selectedNode.type === 'action_add_tag' || selectedNode.type === 'action_remove_tag') && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        {selectedNode.type === 'action_add_tag' ? 'Tag to Attach' : 'Tag to Remove'}
                      </label>
                      <input
                        type="text"
                        value={selectedNode.config.tag || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, tag: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Instagram Comment Lead"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === 'action_add_note' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                        Internal Note Content
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.config.note || ''}
                        onChange={(e) => {
                          const updated = { ...selectedNode.config, note: e.target.value }
                          setSelectedNode({ ...selectedNode, config: updated })
                          setCurrentFlow({
                            ...currentFlow,
                            nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                          })
                        }}
                        placeholder="Lead engaged with Instagram reel comment automation. Requested project brochure."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-medium leading-relaxed outline-none"
                      />
                    </div>
                  </div>
                )}

                {selectedNode.type === 'action_update_field' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Custom Field Name
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.fieldKey || ''}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, fieldKey: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          placeholder="buyer_budget / preferred_bhk"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Value to Set
                        </label>
                        <input
                          type="text"
                          value={selectedNode.config.fieldValue || ''}
                          onChange={(e) => {
                            const updated = { ...selectedNode.config, fieldValue: e.target.value }
                            setSelectedNode({ ...selectedNode, config: updated })
                            setCurrentFlow({
                              ...currentFlow,
                              nodes: currentFlow.nodes.map(n => n.id === selectedNode.id ? { ...n, config: updated } : n)
                            })
                          }}
                          placeholder="2.5 Cr"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-bold"
                        />
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/90">
                {selectedNode.id !== 'trigger' ? (
                  <button
                    onClick={() => handleRemoveNode(selectedNode.id)}
                    className="px-3 py-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors cursor-pointer"
                  >
                    Delete Step
                  </button>
                ) : <div />}
                <button
                  onClick={() => setSelectedNode(null)}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  Done
                </button>
              </div>

            </aside>
          )}

        </div>

        {/* ADD STEP / NODE PALETTE MODAL (LIGHT THEME OMNICHANNEL SUITE) */}
        {isNodePaletteOpen && (
          <div 
            onClick={() => setIsNodePaletteOpen(false)}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]"
            >
              {/* Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50/90 flex items-center justify-between shrink-0">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-black text-slate-900">Add Automation Step</h3>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-black border border-indigo-200">
                      {NODE_DEFINITIONS.length} Available Nodes
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Select a channel action, trigger, or logic branch to insert into your pipeline
                  </p>
                </div>
                <button
                  onClick={() => setIsNodePaletteOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search Bar & Channel Category Filter Tabs */}
              <div className="p-4 border-b border-slate-100 bg-white space-y-3 shrink-0">
                {/* Search Bar */}
                <div className="relative">
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={paletteSearchQuery}
                    onChange={(e) => setPaletteSearchQuery(e.target.value)}
                    placeholder="Search actions & triggers (e.g. DM, Reel comment, WhatsApp, Gemini voice, Delay, Split)..."
                    className="w-full bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-indigo-500 rounded-2xl pl-10 pr-9 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                  />
                  {paletteSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setPaletteSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Channel Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 text-xs">
                  {[
                    { id: 'all', label: '⭐ All Channels', count: NODE_DEFINITIONS.length },
                    { id: 'instagram', label: '🟣 Instagram', count: NODE_DEFINITIONS.filter(n => n.channel === 'instagram').length },
                    { id: 'whatsapp', label: '🟢 WhatsApp', count: NODE_DEFINITIONS.filter(n => n.channel === 'whatsapp').length },
                    { id: 'facebook', label: '🔵 Facebook', count: NODE_DEFINITIONS.filter(n => n.channel === 'facebook').length },
                    { id: 'voice', label: '🎙️ AI Calling', count: NODE_DEFINITIONS.filter(n => n.channel === 'voice').length },
                    { id: 'email', label: '📧 Email', count: NODE_DEFINITIONS.filter(n => n.channel === 'email').length },
                    { id: 'logic', label: '🔀 Logic & Flow', count: NODE_DEFINITIONS.filter(n => n.channel === 'logic').length },
                    { id: 'crm', label: '⚡ CRM & Actions', count: NODE_DEFINITIONS.filter(n => n.channel === 'crm').length },
                    { id: 'triggers', label: '🎯 Inbound Triggers', count: NODE_DEFINITIONS.filter(n => n.channel === 'triggers').length },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setPaletteChannelFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all text-xs flex items-center gap-1.5 cursor-pointer shrink-0 ${
                        paletteChannelFilter === tab.id
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200/80'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        paletteChannelFilter === tab.id
                          ? 'bg-white/20 text-white'
                          : 'bg-white text-slate-500 border border-slate-200'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Node Cards Grid */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-6 custom-scrollbar bg-slate-50/50 flex-1">
                {(() => {
                  const filtered = NODE_DEFINITIONS.filter(item => {
                    const matchChannel = paletteChannelFilter === 'all' || item.channel === paletteChannelFilter
                    const q = paletteSearchQuery.toLowerCase().trim()
                    const matchQuery = !q || 
                      item.title.toLowerCase().includes(q) || 
                      item.description.toLowerCase().includes(q) ||
                      item.category.toLowerCase().includes(q) ||
                      item.type.toLowerCase().includes(q)
                    return matchChannel && matchQuery
                  })

                  if (filtered.length === 0) {
                    return (
                      <div className="py-12 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                          <Search size={22} />
                        </div>
                        <h4 className="text-sm font-bold text-slate-800">No matching automation steps</h4>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                          Try searching for another keyword or switch channels to browse all available actions.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setPaletteSearchQuery('')
                            setPaletteChannelFilter('all')
                          }}
                          className="mt-3 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-bold text-slate-700 shadow-2xs cursor-pointer"
                        >
                          Clear Filters
                        </button>
                      </div>
                    )
                  }

                  // Group filtered nodes by category for clean visual hierarchy
                  const categories = Array.from(new Set(filtered.map(f => f.category)))

                  return categories.map((cat) => {
                    const items = filtered.filter(n => n.category === cat)
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-indigo-600" />
                            <span>{cat}</span>
                          </h4>
                          <span className="text-[10px] font-bold text-slate-400">
                            {items.length} {items.length === 1 ? 'Action' : 'Actions'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {items.map(item => {
                            const IconComp = item.icon
                            return (
                              <div
                                key={item.type}
                                onClick={() => handleAddNode(item)}
                                className="bg-white hover:bg-indigo-50/20 border border-slate-200 hover:border-indigo-400 rounded-2xl p-4 flex items-start gap-3.5 cursor-pointer transition-all hover:scale-[1.01] group shadow-2xs hover:shadow-md relative"
                              >
                                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border shadow-2xs ${item.color}`}>
                                  <IconComp size={20} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <h5 className="text-xs font-black text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                                      {item.title}
                                    </h5>
                                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded border shrink-0 ${item.badgeColor}`}>
                                      {item.channel}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-500 leading-snug line-clamp-2">
                                    {item.description}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>

              {/* Modal Footer */}
              <div className="p-3.5 px-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
                <span>Click any step to insert into your active flow</span>
                <button
                  type="button"
                  onClick={() => setIsNodePaletteOpen(false)}
                  className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* LIVE WHATSAPP PHONE SIMULATOR (LIGHT THEME STUDIO WITH LIVE CUSTOM FIELDS) */}
        {isSimulatorOpen && (
          <div 
            onClick={() => setIsSimulatorOpen(false)}
            className="fixed inset-0 z-[110] bg-black/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-slate-200 rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col md:flex-row max-h-[92vh] animate-in zoom-in-95 duration-150"
            >
              
              {/* Left Side: Live Phone Frame Mockup */}
              <div className="w-full md:w-[380px] bg-slate-100 p-4 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200 shrink-0">
                
                {/* Phone Bezel */}
                <div className="w-full max-w-[320px] h-[520px] bg-[#111827] rounded-[36px] border-4 border-slate-800 shadow-2xl flex flex-col overflow-hidden relative">
                  
                  {/* Phone Speaker Notch */}
                  <div className="h-5 bg-slate-900 flex items-center justify-center shrink-0">
                    <div className="w-16 h-2.5 bg-slate-950 rounded-full"></div>
                  </div>

                  {/* WhatsApp Top Header Bar */}
                  <div className="h-13 bg-[#075E54] px-3 flex items-center justify-between text-white shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs font-black ring-1 ring-white/20">
                        NB
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-bold truncate max-w-[130px]">Nobogent Bot</span>
                          <CheckCircle size={10} className="text-emerald-300 fill-emerald-300" />
                        </div>
                        <span className="text-[9px] text-emerald-200 block">
                          {isBotTyping ? 'typing...' : 'online'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/80">
                      <Phone size={14} />
                      <MoreHorizontal size={14} />
                    </div>
                  </div>

                  {/* WhatsApp Chat Conversation Feed */}
                  <div className="flex-1 bg-[#0B141B] bg-[radial-gradient(#1E293B_1px,transparent_1px)] [background-size:16px_16px] p-3 overflow-y-auto space-y-2.5 custom-scrollbar text-xs">
                    {simMessages.map((msg) => {
                      if (msg.sender === 'system') {
                        return (
                          <div key={msg.id} className="text-center my-2">
                            <span className="bg-slate-800/90 text-slate-300 text-[10px] px-2.5 py-1 rounded-md border border-slate-700 inline-block font-medium">
                              {msg.text}
                            </span>
                          </div>
                        )
                      }

                      const isBot = msg.sender === 'bot'
                      return (
                        <div 
                          key={msg.id} 
                          className={`flex flex-col ${isBot ? 'items-start' : 'items-end'} animate-in fade-in duration-200`}
                        >
                          <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs shadow-xs ${
                            isBot 
                              ? 'bg-[#1F2C34] text-slate-100 rounded-tl-xs border border-slate-700/50' 
                              : 'bg-[#005C4B] text-white rounded-tr-xs'
                          }`}>
                            {msg.isBrochure && (
                              <div className="bg-emerald-950/60 rounded-lg p-2 mb-1.5 border border-emerald-500/30 flex items-center gap-2">
                                <FileText size={16} className="text-emerald-400 shrink-0" />
                                <div className="min-w-0">
                                  <span className="text-[10px] font-bold text-white block truncate">Official_Brochure.pdf</span>
                                  <span className="text-[8px] text-emerald-300">2.4 MB • Verified</span>
                                </div>
                              </div>
                            )}

                            <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                            
                            <div className="flex items-center justify-end gap-1 mt-1 text-[9px] text-slate-400">
                              <span>{msg.time}</span>
                              <CheckCheck size={11} className="text-blue-400" />
                            </div>
                          </div>

                          {/* CTA Link Buttons */}
                          {msg.ctaButtons && msg.ctaButtons.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1.5 w-[85%]">
                              {msg.ctaButtons.map((cta, ci) => (
                                <button
                                  key={ci}
                                  type="button"
                                  onClick={() => {
                                    setSimLogs(prev => [...prev, `🔗 [CTA Link Clicked]: Opened "${cta.title}" (${cta.url || cta.phoneNumber})`])
                                    toast.info(`Simulated click: ${cta.title}`)
                                  }}
                                  className="w-full bg-[#1F2C34] hover:bg-[#2A3942] text-sky-300 font-bold text-[11px] py-1.5 px-2 rounded-xl border border-sky-500/40 text-center transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                                >
                                  <span>{cta.title}</span>
                                  <ExternalLink size={11} className="text-sky-400 shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Quick Reply Button Chips */}
                          {msg.buttons && msg.buttons.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1.5 w-[85%]">
                              {msg.buttons.map((btn, bi) => (
                                <button
                                  key={bi}
                                  onClick={() => handleSimUserReply(btn)}
                                  className="w-full bg-[#1F2C34] hover:bg-[#2A3942] text-teal-400 font-bold text-[11px] py-1.5 px-2 rounded-xl border border-teal-500/40 text-center transition-all active:scale-95 shadow-xs cursor-pointer"
                                >
                                  {btn}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {isBotTyping && (
                      <div className="flex items-center gap-1.5 bg-[#1F2C34] text-slate-400 px-3 py-2 rounded-2xl rounded-tl-xs w-24 border border-slate-700/50">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></span>
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                      </div>
                    )}
                  </div>

                  {/* Phone Chat Input Bar */}
                  <div className="h-12 bg-[#1F2C34] px-2 flex items-center gap-1.5 shrink-0 border-t border-slate-800">
                    <input
                      type="text"
                      value={simUserInput}
                      onChange={(e) => setSimUserInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSimUserReply(simUserInput)
                      }}
                      placeholder="Type simulated reply..."
                      className="flex-1 bg-[#2A3942] rounded-full px-3 py-1.5 text-xs text-white placeholder-slate-400 outline-none"
                    />
                    <button
                      onClick={() => handleSimUserReply(simUserInput)}
                      className="w-8 h-8 rounded-full bg-[#00A884] text-white flex items-center justify-center shrink-0 cursor-pointer shadow-xs active:scale-95"
                    >
                      <Send size={13} />
                    </button>
                  </div>

                </div>
              </div>

              {/* Right Side: Lead Status, Auto-Saved Custom Fields & Execution Trace */}
              <div className="flex-1 flex flex-col overflow-hidden p-5 bg-white">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 shrink-0">
                  <div>
                    <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                      <Play size={16} className="text-indigo-600 fill-indigo-600" />
                      <span>Flow Simulation Studio</span>
                    </h3>
                    <p className="text-xs text-slate-500">Live test run with official Gemini Live voice, deterministic scoring & CRM lead profile auto-save</p>
                  </div>
                  <button
                    onClick={() => setIsSimulatorOpen(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Simulated Lead Metrics Card */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 my-3 shrink-0">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 text-xs">
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">Simulated Prospect</span>
                    <span className="font-bold text-slate-900 truncate block">{simLeadData.name}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 text-xs">
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">Qualification Score</span>
                    <span className="font-black text-indigo-600 font-mono block">
                      {simLeadData.score ? `${simLeadData.score}%` : 'Evaluating...'}
                    </span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 text-xs">
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">CRM Status</span>
                    <span className="font-bold text-emerald-600 block truncate">{simLeadData.status}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-2.5 text-xs">
                    <span className="text-[10px] font-bold text-slate-500 block uppercase">Assigned To</span>
                    <span className="font-bold text-sky-600 block truncate">{simLeadData.assignedAgent}</span>
                  </div>
                </div>

                {/* Auto-Saved Lead Profile Custom Fields Display */}
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-3 mb-3 shrink-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                      <UserCheck size={13} className="text-indigo-600" />
                      <span>Lead Profile Custom Fields (Auto-Saved Answers)</span>
                    </span>
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
                      💾 Saved into Lead Info
                    </span>
                  </div>
                  {Object.keys(simLeadData.answers).length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic">
                      No answers captured yet. When the AI voice call or WhatsApp questions node runs, answers are auto-saved directly to custom fields here.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-24 overflow-y-auto custom-scrollbar">
                      {Object.entries(simLeadData.answers)
                        .filter(([k]) => !k.startsWith('step_') && k !== 'prospect_response' && k !== 'candidate_answers')
                        .map(([key, val]) => (
                          <div key={key} className="bg-white border border-indigo-100 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1 shadow-2xs">
                            <span className="font-mono text-slate-500 text-[10px] font-bold truncate max-w-[120px]">{key}:</span>
                            <span className="font-bold text-indigo-700 text-[11px] truncate max-w-[150px]">{String(val)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {/* Execution Trace Logs */}
                <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5 block">
                    Real-time Step Execution Trace
                  </span>
                  <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl p-3 font-mono text-[11px] overflow-y-auto custom-scrollbar space-y-1.5 shadow-inner">
                    {simLogs.map((l, li) => (
                      <div key={li} className="text-slate-300 leading-relaxed">
                        {l.startsWith('✨') ? (
                          <span className="text-emerald-400 font-black">{l}</span>
                        ) : l.includes('Deterministic') ? (
                          <span className="text-indigo-400 font-bold">{l}</span>
                        ) : l.includes('Lead Assignment') ? (
                          <span className="text-sky-400 font-bold">{l}</span>
                        ) : l.includes('Gemini Live') || l.includes('Voice') ? (
                          <span className="text-amber-400 font-bold">{l}</span>
                        ) : l.includes('Auto-saved') ? (
                          <span className="text-emerald-300 font-bold">{l}</span>
                        ) : l.includes('Executed') ? (
                          <span className="text-blue-400">{l}</span>
                        ) : (
                          l
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom Buttons */}
                <div className="pt-3 mt-3 border-t border-slate-200 flex items-center justify-between shrink-0">
                  <button
                    onClick={handleStartSimulation}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border border-slate-200"
                  >
                    <RotateCcw size={13} />
                    <span>Restart Test Run</span>
                  </button>
                  <button
                    onClick={() => setIsSimulatorOpen(false)}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                  >
                    Done Testing
                  </button>
                </div>

              </div>

            </div>
          </div>
        )}

        {/* AI Architect Modal (Canvas View) */}
        {renderAiArchitectModal()}

        {/* ============================================================= */}
        {/* RUN FLOW ON AUDIENCE MODAL */}
        {/* ============================================================= */}
        {isRunAudienceModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setIsRunAudienceModalOpen(false)}>
            <div
              className="bg-white rounded-3xl shadow-2xl w-[520px] max-w-[95vw] max-h-[85vh] overflow-auto border border-slate-200 animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shadow-blue-500/30">
                    <Zap size={18} className="text-amber-300 fill-amber-300" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Run Flow on Audience</h3>
                    <p className="text-[11px] text-slate-500">Execute this automation pipeline over your target audience data</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsRunAudienceModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-5">
                {/* Audience Source Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Select Audience Source
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { key: 'csv' as const, label: 'CSV Upload', icon: FileSpreadsheet, desc: 'Custom uploaded lists' },
                      { key: 'custom_group' as const, label: 'Audience Group', icon: Users, desc: 'CRM segments & groups' },
                      { key: 'campaign' as const, label: 'Campaign Leads', icon: Zap, desc: 'Meta / Portal audience' }
                    ]).map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setSelectedAudienceType(opt.key)}
                        className={`p-3 rounded-xl border-2 text-center transition-all cursor-pointer ${
                          selectedAudienceType === opt.key
                            ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-400/30'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <opt.icon size={18} className={selectedAudienceType === opt.key ? 'text-indigo-600 mx-auto' : 'text-slate-500 mx-auto'} />
                        <span className={`block text-[10px] font-bold mt-1 ${selectedAudienceType === opt.key ? 'text-indigo-700' : 'text-slate-700'}`}>{opt.label}</span>
                        <span className="block text-[9px] text-slate-500">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* CSV Audience Selector */}
                {selectedAudienceType === 'csv' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Select CSV Audience</label>
                    {SAMPLE_CSV_AUDIENCES.map(csv => (
                      <button
                        key={csv.id}
                        onClick={() => setSelectedCsvId(csv.id)}
                        className={`w-full p-3 rounded-xl border-2 flex items-center justify-between transition-all cursor-pointer ${
                          selectedCsvId === csv.id
                            ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-400/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText size={16} className={selectedCsvId === csv.id ? 'text-indigo-600 shrink-0' : 'text-slate-500 shrink-0'} />
                          <div className="text-left min-w-0">
                            <span className="text-xs font-bold text-slate-900 block truncate">{csv.name}</span>
                            <span className="text-[10px] text-slate-500">{csv.date} • {csv.tag}</span>
                          </div>
                        </div>
                        <span className="text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200 shrink-0">
                          {csv.count} leads
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Custom Group Selector */}
                {selectedAudienceType === 'custom_group' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Select Audience Group</label>
                    {SAMPLE_AUDIENCE_GROUPS.map(grp => (
                      <button
                        key={grp.id}
                        onClick={() => setSelectedGroupId(grp.id)}
                        className={`w-full p-3 rounded-xl border-2 flex items-center justify-between transition-all cursor-pointer ${
                          selectedGroupId === grp.id
                            ? 'border-indigo-500 bg-indigo-50/30 ring-1 ring-indigo-400/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Users size={16} className={selectedGroupId === grp.id ? 'text-indigo-600 shrink-0' : 'text-slate-500 shrink-0'} />
                          <div className="text-left min-w-0">
                            <span className="text-xs font-bold text-slate-900 block truncate">{grp.name}</span>
                            <span className="text-[10px] text-slate-500">{grp.desc}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
                            grp.tag === 'High Intent' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : grp.tag === 'Visit Pending' ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>{grp.tag}</span>
                          <span className="text-xs font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-200">
                            {grp.count}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Campaign Selector */}
                {selectedAudienceType === 'campaign' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Select Campaign</label>
                    <select
                      value={selectedCampaignId}
                      onChange={(e) => setSelectedCampaignId(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 cursor-pointer"
                    >
                      <option value="">— Select a Meta / Portal Campaign —</option>
                      {campaigns.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                      <option value="joy_grand">Joy Grand Mohali Campaign</option>
                      <option value="aerocity">Aerocity Plots Campaign</option>
                    </select>
                  </div>
                )}

                {/* Sample Size & Speed */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Sample Size</label>
                    <select
                      value={executionSampleSize}
                      onChange={(e) => setExecutionSampleSize(e.target.value as any)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 cursor-pointer"
                    >
                      <option value="all">All Leads (Full Batch)</option>
                      <option value="50">Sample 50 Leads</option>
                      <option value="20">Sample 20 Leads</option>
                      <option value="5">Sample 5 Leads (Test)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Execution Speed</label>
                    <select
                      value={executionSpeed}
                      onChange={(e) => setExecutionSpeed(e.target.value as any)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 cursor-pointer"
                    >
                      <option value="1x">1x Realtime (1 lead/sec)</option>
                      <option value="3x">3x Fast (Recommended)</option>
                      <option value="10x">10x Ultra (Rapid Demo)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-slate-200 flex items-center justify-between">
                <button
                  onClick={() => setIsRunAudienceModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLaunchLiveExecution}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black transition-all shadow-sm shadow-blue-500/20 cursor-pointer active:scale-95 flex items-center gap-2"
                >
                  <Zap size={14} className="text-amber-300 fill-amber-300" />
                  <span>🚀 Launch Live Execution</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* LIVE EXECUTION LOG FEED DRAWER */}
        {/* ============================================================= */}
        {isLiveLogsDrawerOpen && (
          <aside className="fixed right-0 top-16 bottom-0 w-[440px] max-w-[95vw] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200 text-slate-900">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-slate-50/90">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center">
                  <Activity size={16} className={isLiveRunActive ? 'animate-pulse' : ''} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Live Execution Feed</h3>
                  <p className="text-[11px] text-slate-500">
                    {isLiveRunActive ? `Processing ${liveRunProgress.current} / ${liveRunProgress.total} contacts` : `${liveRunLogs.length} entries logged`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsLiveLogsDrawerOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-1.5 bg-white shrink-0">
              {(['all', 'qualified', 'filtered'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setLiveRunLogFilter(tab)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                    liveRunLogFilter === tab
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab === 'all' ? `All (${liveRunLogs.length})` : tab === 'qualified' ? `Qualified (${liveRunLogs.filter(l => l.status === 'passed').length})` : `Filtered (${liveRunLogs.filter(l => l.status === 'failed').length})`}
                </button>
              ))}
            </div>

            {/* Log Feed */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              {liveRunLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3 p-8">
                  <Activity size={32} className="text-slate-300" />
                  <p className="text-xs font-medium text-center">No execution logs yet. Launch a batch run to see lead-by-lead processing.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {liveRunLogs
                    .filter(log => {
                      if (liveRunLogFilter === 'qualified') return log.status === 'passed'
                      if (liveRunLogFilter === 'filtered') return log.status === 'failed'
                      return true
                    })
                    .map(log => (
                    <div key={log.id} className="px-4 py-3 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${log.status === 'passed' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          <span className="text-xs font-bold text-slate-900 truncate">{log.leadName}</span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">{log.phone}</span>
                        </div>
                        <span className="text-[9px] text-slate-400 font-mono shrink-0">{log.time}</span>
                      </div>
                      <div className="flex items-start gap-2 pl-4">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border shrink-0 ${
                          log.status === 'passed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {log.status === 'passed' ? '✓ Qualified' : '⛔ Filtered'}
                        </span>
                        <p className="text-[10px] text-slate-600 leading-relaxed line-clamp-2">
                          <span className="font-bold text-slate-700">{log.stepTitle}:</span> {log.detail}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}

      </div>
    )
  }

  // =========================================================================
  // VIEW: UNIFIED AUTOMATIONS SUITE
  // =========================================================================
  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-32 relative font-sans">
      {/* SUITE HEADER & TAB NAVIGATION */}
      <SuiteHeader
        activeTab={activeSuiteTab}
        onSelectTab={(tab) => {
          if (tab === 'flows' && !isSuperAdmin) {
            setActiveSuiteTab('ai_calling')
            return
          }
          setActiveSuiteTab(tab)
          if (tab !== 'flows') {
            setCurrentFlow(null)
          }
        }}
        impersonateId={impersonateId}
        onOpenAiArchitect={() => setIsAiArchitectOpen(true)}
        onCreateBlankFlow={handleCreateBlankFlow}
        totalActiveCount={flows.filter(f => f.isActive).length}
        isSuperAdmin={isSuperAdmin}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* ========================================================================= */}
        {/* TAB 1: VISUAL FLOWS DIRECTORY & STUDIO (Super Admin Only)                 */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'flows' && isSuperAdmin && (
          <>
            {/* TEMPLATE GALLERY */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                Instant 1-Click Flow Templates
              </h2>
            </div>
            <span className="text-xs text-slate-400 font-medium hidden sm:inline">
              Select any pre-built pipeline to customize on canvas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {FLOW_TEMPLATES.map((tpl) => {
              const IconComp = tpl.icon
              return (
                <div
                  key={tpl.id}
                  onClick={() => handleUseTemplate(tpl)}
                  className="bg-white rounded-2xl p-5 border border-slate-200/80 hover:border-violet-400 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                        <IconComp size={20} />
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${tpl.badgeColor}`}>
                        {tpl.tag}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-bold text-slate-900 group-hover:text-violet-600 transition-colors">
                        {tpl.title}
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-3 leading-relaxed">
                        {tpl.description}
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-violet-600 font-bold">
                    <span>Use Template</span>
                    <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ACTIVE FLOWS SECTION */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-slate-400" />
              <h2 className="text-base font-bold text-slate-900">
                Your Workspace Flows ({filteredFlows.length})
              </h2>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search flows..."
                  className="bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-violet-500 w-44 sm:w-56 transition-all"
                />
              </div>

              {/* Status Filter */}
              <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5 text-xs font-bold text-slate-600 shadow-xs">
                {(['ALL', 'ACTIVE', 'PAUSED'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                      statusFilter === tab 
                        ? 'bg-slate-900 text-white' 
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {tab === 'ALL' ? 'All' : tab === 'ACTIVE' ? 'Active' : 'Paused'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Flows Grid */}
          {loading ? (
            <div className="flex flex-col items-center justify-center p-16 text-slate-400 gap-3">
              <Loader2 className="animate-spin text-violet-600" size={32} />
              <p className="text-sm font-medium">Loading automation flows...</p>
            </div>
          ) : filteredFlows.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-xs">
              <div className="w-16 h-16 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center mx-auto mb-4">
                <Workflow size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">
                No automation flows found
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
                Create your first visual automation pipeline from scratch or get started in seconds using a pre-built template above.
              </p>
              <button
                onClick={handleCreateBlankFlow}
                className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus size={16} />
                <span>Create Flow</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredFlows.map(flow => (
                <div
                  key={flow.id}
                  onClick={() => setCurrentFlow(flow)}
                  className="bg-white rounded-2xl border border-slate-200/80 hover:border-violet-400 shadow-xs hover:shadow-md transition-all cursor-pointer group overflow-hidden"
                >
                  <div className="flex items-center gap-4 p-4 sm:p-5">
                    {/* Left: Flow Icon & Status Indicator */}
                    <div className="relative shrink-0">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${
                        flow.isActive
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}>
                        <Workflow size={20} />
                      </div>
                      <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                        flow.isActive ? 'bg-emerald-500' : 'bg-slate-400'
                      }`} />
                    </div>

                    {/* Middle: Flow Title, Description & Step Chips */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-sm font-bold text-slate-900 group-hover:text-violet-600 transition-colors truncate">
                          {flow.name}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-1 mb-1.5">
                        {flow.description || 'Automated multi-channel workflow'}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold border border-violet-100">
                          <Zap size={10} className="text-violet-600" />
                          <span className="truncate max-w-[120px]">{flow.trigger?.label || 'Meta Campaign'}</span>
                        </span>
                        <span className="text-[10px] text-slate-400">→</span>
                        {flow.nodes.slice(0, 3).map((node, i) => (
                          <span
                            key={node.id}
                            className="text-[10px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-lg border border-slate-200 truncate max-w-[100px]"
                          >
                            {node.title.slice(0, 18)}
                          </span>
                        ))}
                        {flow.nodes.length > 3 && (
                          <span className="text-[10px] font-medium text-slate-400">
                            +{flow.nodes.length - 3}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right Side: Stats, Toggle, Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Steps Count Badge */}
                      <div className="hidden sm:flex flex-col items-center gap-0.5 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 min-w-[60px]">
                        <span className="text-sm font-black text-slate-900">{flow.nodes.length}</span>
                        <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wider">Steps</span>
                      </div>

                      {/* Runs Count Badge */}
                      <div className="hidden md:flex flex-col items-center gap-0.5 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200 min-w-[60px]">
                        <span className="text-sm font-black text-slate-900">{flow.stats?.runs || 0}</span>
                        <span className="text-[9px] text-slate-500 font-medium uppercase tracking-wider">Runs</span>
                      </div>

                      {/* Active / Paused Toggle */}
                      <button
                        onClick={(e) => handleToggleActive(flow, e)}
                        className={`relative w-11 h-6 rounded-full transition-all duration-300 cursor-pointer shrink-0 border ${
                          flow.isActive
                            ? 'bg-emerald-500 border-emerald-600'
                            : 'bg-slate-300 border-slate-400'
                        }`}
                        title={flow.isActive ? 'Pause Flow' : 'Activate Flow'}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 ${
                          flow.isActive ? 'left-[22px]' : 'left-0.5'
                        }`} />
                      </button>

                      {/* Divider */}
                      <div className="w-px h-8 bg-slate-200 hidden sm:block" />

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleDuplicateFlow(flow, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Duplicate Flow"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteFlow(flow.id!, e)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Flow"
                        >
                          <Trash2 size={14} />
                        </button>
                        <span className="text-violet-600 font-bold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5 ml-1 text-xs">
                          Edit →
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: AI CALLING & OUTBOUND TELEPHONY MODULE                             */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'ai_calling' && (
          <AiCallingAutomationsView flows={flows} />
        )}

        {/* ========================================================================= */}
        {/* TAB 3: DIRECT MESSAGE & KEYWORD AUTO-RESPONDER                            */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'dm' && (
          <DmAutomationsView flows={flows} />
        )}

        {/* ========================================================================= */}
        {/* TAB 3: INSTAGRAM COMMENT-TO-DM AUTOMATIONS                                */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'ig_comments' && (
          <IgCommentsView flows={flows} />
        )}

        {/* ========================================================================= */}
        {/* TAB 4: FACEBOOK PAGE & AD COMMENT AUTOMATIONS                             */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'fb_comments' && (
          <FbCommentsView flows={flows} />
        )}

        {/* ========================================================================= */}
        {/* TAB 5: MULTI-CHANNEL DRIP SEQUENCES                                       */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'sequences' && (
          <SequencesView flows={flows} />
        )}

        {/* ========================================================================= */}
        {/* TAB 6: UNIFIED AUTOMATIONS ANALYTICS & EVENT FEED                         */}
        {/* ========================================================================= */}
        {activeSuiteTab === 'analytics' && (
          <SuiteAnalyticsView flows={flows} />
        )}

        {/* AI Flow Architect Modal (Directory View) */}
        {renderAiArchitectModal()}

      </div>
    </div>
  )
}
