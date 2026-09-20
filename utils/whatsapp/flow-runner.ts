import { sendAdminMultiChannelNotification } from '@/utils/notification-helper'
import { sendLeadNotificationEmail, resolveNotificationRecipients } from '@/utils/email-helper'

export interface FlowRunnerParams {
  supabaseAdmin: any
  ownerUserId: string
  ownerWaToken: string
  ownerWaPhoneId: string
  ownerBusinessName: string
  ownerCustomDomain: string | null
  ownerContactNumber?: string
  cleanFrom: string
  chat: { id: string; recipient_name?: string; flow_answers?: any }
  latestLead: {
    id: string
    name?: string
    phone?: string
    custom_fields?: any
    pipeline_stage?: string
    tags?: string[]
  } | null
  messageType: string // 'button' | 'interactive' | 'text' | 'image' | etc.
  buttonReplyId?: string | null
  buttonReplyTitle?: string | null
  messageText?: string
  contextMessageId?: string | null
  isFromAd?: boolean
  campaignId?: string | null
  lastSentTemplate?: string | null
}

export interface FlowRunnerResult {
  handled: boolean
  flowId?: string
  flowName?: string
  actionsExecuted?: string[]
}

/**
 * Interpolate dynamic variables in template strings
 */
function interpolateVariables(text: string, vars: Record<string, string>): string {
  if (!text) return ''
  let result = text
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi')
    result = result.replace(regex, value || '')
  }
  return result
}

/**
 * Checks whether an incoming message satisfies a flow trigger.
 * Supports Omni-Channel triggers: Meta Ads / Click-to-WhatsApp, Inbound Keywords,
 * Comments, DMs, CRM Stage triggers, and Broadcast Quick Replies.
 * Strictly isolates campaigns when templateName is configured on the trigger.
 */
function isTriggerMatched(
  trigger: any,
  params: {
    isButtonClick: boolean
    buttonReplyId?: string | null
    buttonReplyTitle?: string | null
    messageText?: string
    isFromAd?: boolean
    campaignId?: string | null
    lastSentTemplate?: string | null
  }
): boolean {
  if (!trigger) return false
  const triggerType = (trigger.type || '').toLowerCase()
  const config = trigger.data || trigger.config || {}
  const specificTriggerType = (config.triggerType || config.type || '').toLowerCase()

  const buttonText = (params.buttonReplyTitle || params.buttonReplyId || '').trim().toLowerCase()
  const rawText = (params.messageText || '').trim().toLowerCase()

  // 1. Meta Ad / Click-to-WhatsApp Trigger
  if (
    triggerType === 'trigger_meta_ad' ||
    triggerType === 'meta_ad' ||
    triggerType === 'trigger_whatsapp_ctwa' ||
    (triggerType === 'triggernode' && (specificTriggerType === 'meta_ad' || specificTriggerType === 'click_to_whatsapp'))
  ) {
    if (config.campaignId && params.campaignId) {
      return String(config.campaignId) === String(params.campaignId)
    }
    if (params.isFromAd) return true
    return !params.isButtonClick || rawText.length > 0
  }

  // 2. WhatsApp Inbound / Keyword Trigger
  if (
    triggerType === 'trigger_whatsapp_inbound' ||
    triggerType === 'whatsapp_inbound' ||
    (triggerType === 'triggernode' && specificTriggerType === 'whatsapp_inbound')
  ) {
    const rawKeywords = config.keywords || config.keyword
    let keywordsList: string[] = []
    if (Array.isArray(rawKeywords)) {
      keywordsList = rawKeywords
    } else if (typeof rawKeywords === 'string' && rawKeywords.trim()) {
      keywordsList = rawKeywords.split(',').map(s => s.trim()).filter(Boolean)
    }

    if (keywordsList.length > 0) {
      return keywordsList.some(k => rawText.includes(k.toLowerCase()))
    }
    return true
  }

  // 3. Instagram / Facebook Comment Trigger
  if (
    triggerType === 'trigger_ig_comment' ||
    triggerType === 'trigger_fb_comment' ||
    (triggerType === 'triggernode' && (specificTriggerType === 'ig_comment' || specificTriggerType === 'fb_comment'))
  ) {
    return true
  }

  // 4. Instagram / Messenger DM Trigger
  if (
    triggerType === 'trigger_ig_dm' ||
    triggerType === 'trigger_fb_messenger' ||
    (triggerType === 'triggernode' && (specificTriggerType === 'ig_dm' || specificTriggerType === 'fb_dm'))
  ) {
    return true
  }

  // 5. CRM Lead Arrival Trigger
  if (
    triggerType === 'trigger_crm_lead' ||
    triggerType === 'crm_lead' ||
    (triggerType === 'triggernode' && specificTriggerType === 'crm_lead')
  ) {
    return true
  }

  // 6. Template Quick Reply Button / Broadcast Trigger
  if (
    triggerType === 'trigger_whatsapp_template_button' ||
    triggerType === 'trigger_whatsapp_quick_reply' ||
    (triggerType === 'triggernode' && (specificTriggerType === 'whatsapp_broadcast' || config.templateName || trigger.templateName)) ||
    config.trigger_on === 'button_click'
  ) {
    if (!params.isButtonClick) return false

    // STRICT CAMPAIGN TEMPLATE ISOLATION:
    // If this flow specifies a templateName, only trigger if the lead received that specific template!
    const targetTemplate = (config.templateName || trigger.templateName || trigger.template_name || '').trim().toLowerCase()
    if (targetTemplate && params.lastSentTemplate) {
      if (targetTemplate !== params.lastSentTemplate.trim().toLowerCase()) {
        console.log(`[FlowRunner] ⏭️ Skipping flow: Template mismatch. Expected "${targetTemplate}", but lead was sent "${params.lastSentTemplate}"`)
        return false
      }
    }

    const targetButton = (config.button_text || config.button_title || config.button_id || 'interested').trim().toLowerCase()
    if (buttonText === targetButton || buttonText.includes(targetButton) || targetButton.includes(buttonText)) {
      return true
    }
    if (Array.isArray(config.buttons)) {
      return config.buttons.some((b: any) => {
        const t = (typeof b === 'string' ? b : (b.title || b.id || '')).trim().toLowerCase()
        return buttonText.includes(t) || t.includes(buttonText)
      })
    }
    if (buttonText.includes('interest')) {
      if (targetTemplate && params.lastSentTemplate && targetTemplate !== params.lastSentTemplate.trim().toLowerCase()) {
        return false
      }
      return true
    }
    return false
  }

  // Fallback for generic triggerNode: matches if buttons match or on inbound
  if (triggerType === 'triggernode') {
    const targetTemplate = (config.templateName || trigger.templateName || trigger.template_name || '').trim().toLowerCase()
    if (targetTemplate && params.lastSentTemplate && targetTemplate !== params.lastSentTemplate.trim().toLowerCase()) {
      return false
    }

    if (Array.isArray(config.buttons) && config.buttons.length > 0) {
      if (params.isButtonClick) {
        return config.buttons.some((b: any) => {
          const t = (typeof b === 'string' ? b : (b.title || b.id || '')).trim().toLowerCase()
          return buttonText.includes(t) || t.includes(buttonText)
        })
      }
      return false
    }
    return true
  }

  return false
}

/**
 * Execute dynamic WhatsApp automation flows for an incoming webhook event.
 * If an active flow matches the trigger, it executes all action nodes in order and returns
 * { handled: true }, signaling the webhook to bypass default conversational AI and 3-button menus.
 */
export async function executeFlowRunner(params: FlowRunnerParams): Promise<FlowRunnerResult> {
  const {
    supabaseAdmin,
    ownerUserId,
    ownerWaToken,
    ownerWaPhoneId,
    ownerBusinessName,
    ownerCustomDomain,
    ownerContactNumber,
    cleanFrom,
    chat,
    latestLead,
    messageType,
    buttonReplyId,
    buttonReplyTitle,
    messageText
  } = params

  if (!ownerUserId || !ownerWaToken || !ownerWaPhoneId) {
    return { handled: false }
  }

  // Detect whether this is a genuine button reply (from a template quick reply or interactive reply)
  const isButtonClick =
    messageType === 'button' ||
    messageType === 'interactive' ||
    Boolean(buttonReplyId) ||
    (Boolean(buttonReplyTitle) && messageType !== 'text')

  console.log(`[FlowRunner] Evaluating flows for user ${ownerUserId}. isButtonClick=${isButtonClick}, buttonTitle="${buttonReplyTitle || ''}", text="${messageText || ''}"`)

  // Fetch active flows for this owner from the automations table
  const { data: rawFlows, error: flowErr } = await supabaseAdmin
    .from('automations')
    .select('*')
    .eq('user_id', ownerUserId)
    .like('title', 'Flow:%')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (flowErr || !rawFlows || rawFlows.length === 0) {
    return { handled: false }
  }

  // Resolve last sent template to enable multi-campaign isolation
  let resolvedTemplateName = params.lastSentTemplate || null

  if (!resolvedTemplateName && chat?.id) {
    try {
      const { data: recentTemplateMsg } = await supabaseAdmin
        .from('whatsapp_messages')
        .select('message_text')
        .eq('chat_id', chat.id)
        .eq('direction', 'outbound')
        .like('message_text', 'Sent Template:%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentTemplateMsg?.message_text) {
        resolvedTemplateName = recentTemplateMsg.message_text.replace(/^Sent Template:\s*/i, '').trim()
        console.log(`[FlowRunner] 🏷️ Identified last sent template from chat history: "${resolvedTemplateName}"`)
      }
    } catch (msgErr) {
      console.warn('[FlowRunner] Could not query recent template message:', msgErr)
    }
  }

  // Resolve outbound broadcast details to enable flow-level campaign isolation
  let matchedBroadcastTitle: string | null = null
  if (cleanFrom) {
    try {
      const { data: bcastRec } = await supabaseAdmin
        .from('whatsapp_broadcast_recipients')
        .select('broadcast_id, whatsapp_broadcasts(title, template_name)')
        .eq('phone_number', cleanFrom)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const foundName = (bcastRec as any)?.whatsapp_broadcasts?.template_name
      if (foundName && !resolvedTemplateName) {
        resolvedTemplateName = foundName.trim()
        console.log(`[FlowRunner] 🏷️ Identified last sent template from broadcast recipient: "${resolvedTemplateName}"`)
      }
      matchedBroadcastTitle = (bcastRec as any)?.whatsapp_broadcasts?.title || null
      if (matchedBroadcastTitle) {
        console.log(`[FlowRunner] 📢 Outbound broadcast detected for lead: "${matchedBroadcastTitle}"`)
      }
    } catch (bcastErr) {
      // ignore
    }
  }

  // Parse and find the first matching flow
  let matchedFlow: any = null
  let matchedFlowRecordId: string | null = null

  for (const row of rawFlows) {
    try {
      const flowData = JSON.parse(row.description || '{}')
      let trigger = flowData.trigger
      if (!trigger && Array.isArray(flowData.xyNodes)) {
        trigger = flowData.xyNodes.find((n: any) => n.type === 'triggerNode')
      }
      if (!trigger && Array.isArray(flowData.nodes)) {
        trigger = flowData.nodes.find((n: any) => n.type === 'triggerNode')
      }

      // STRICT FLOW-LEVEL CAMPAIGN ISOLATION:
      // If the broadcast was launched from a specific flow (tagged with [flow:<flow_id>]),
      // then ONLY that flow is allowed to handle incoming button clicks!
      if (matchedBroadcastTitle && matchedBroadcastTitle.includes('[flow:')) {
        const flowIdMatch = matchedBroadcastTitle.match(/\[flow:([a-zA-Z0-9_-]+)\]/)
        if (flowIdMatch && flowIdMatch[1]) {
          const boundFlowId = flowIdMatch[1]
          if (row.id !== boundFlowId) {
            console.log(`[FlowRunner] ⏭️ Skipping flow "${flowData.name || row.title}": Broadcast was explicitly launched by flow "${boundFlowId}", not "${row.id}".`)
            continue
          }
        }
      }

      const triggerConfig = trigger?.data || trigger?.config || trigger || {}
      const targetTemplate = (triggerConfig.templateName || trigger?.templateName || trigger?.template_name || '').trim().toLowerCase()

      // If the trigger explicitly specifies a template, and we know the last sent template, ensure they match!
      if (targetTemplate && resolvedTemplateName && targetTemplate !== resolvedTemplateName.trim().toLowerCase()) {
        console.log(`[FlowRunner] ⏭️ Skipping flow "${flowData.name || row.title}": Template mismatch (flow expects "${targetTemplate}", recipient had "${resolvedTemplateName}")`)
        continue
      }

      // Check if button clicked matches any button on a message card in the flow
      const allFlowNodes = Array.isArray(flowData.xyNodes) ? flowData.xyNodes : (Array.isArray(flowData.nodes) ? flowData.nodes : [])
      const hasMatchingCardButton = !targetTemplate && isButtonClick && allFlowNodes.some((n: any) => {
        const btns = n.data?.buttons || n.config?.buttons || []
        const cleanBtn = (buttonReplyTitle || buttonReplyId || '').trim().toLowerCase()
        return btns.some((b: any) => {
          const t = (typeof b === 'string' ? b : (b.title || b.id || '')).trim().toLowerCase()
          return cleanBtn.includes(t) || t.includes(cleanBtn)
        })
      })

      const matches = isTriggerMatched(trigger, {
        isButtonClick,
        buttonReplyId,
        buttonReplyTitle,
        messageText,
        isFromAd: params.isFromAd,
        campaignId: params.campaignId,
        lastSentTemplate: resolvedTemplateName
      }) || hasMatchingCardButton

      if (matches) {
        matchedFlow = flowData
        matchedFlowRecordId = row.id
        console.log(`[FlowRunner] 🎯 Matched active flow: "${flowData.name || row.title}" (ID: ${row.id})`)
        break
      }
    } catch (parseErr) {
      console.error(`[FlowRunner] Error parsing flow description for row ${row.id}:`, parseErr)
    }
  }

  if (!matchedFlow) {
    return { handled: false }
  }

  // Resolve workspace notification & owner emails
  let ownerResolvedEmail = ''
  let ownerResolvedBcc: string | undefined = undefined
  try {
    const { data: ownerProf } = await supabaseAdmin
      .from('profiles')
      .select('email, business_info')
      .eq('id', ownerUserId)
      .maybeSingle()
    if (ownerProf) {
      const rec = resolveNotificationRecipients(ownerProf)
      ownerResolvedEmail = rec.toEmail || ''
      ownerResolvedBcc = rec.bccEmail
    }
  } catch (profErr) {
    console.warn('[FlowRunner] Warning: Could not resolve owner email recipients:', profErr)
  }

  // Build dynamic variable dictionary
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com'
  const inventoryUrl = ownerCustomDomain
    ? `https://${ownerCustomDomain}`
    : `${appUrl}/shared/${ownerUserId}`
  const bookingUrl = latestLead?.id
    ? `${inventoryUrl}/booking/${latestLead.id}`
    : `${inventoryUrl}/booking`

  const leadName = chat.recipient_name || latestLead?.name || 'there'
  const leadPhone = '+' + cleanFrom
  const leadEmail = (latestLead as any)?.email || ''

  const variableMap: Record<string, string> = {
    inventory_url: inventoryUrl,
    catalogue_url: inventoryUrl,
    booking_link: bookingUrl,
    booking_url: bookingUrl,
    lead_name: leadName,
    lead_phone: leadPhone,
    phone: leadPhone,
    lead_email: leadEmail,
    owner_email: ownerResolvedEmail,
    business_name: ownerBusinessName || 'our company',
    contact_number: ownerContactNumber || '',
    app_url: appUrl
  }

  // Support both xyNodes (ManyChat canvas) and standard nodes
  const allNodes: any[] = Array.isArray(matchedFlow.xyNodes) && matchedFlow.xyNodes.length > 0
    ? matchedFlow.xyNodes
    : (Array.isArray(matchedFlow.nodes) ? matchedFlow.nodes : [])

  const edges: any[] = Array.isArray(matchedFlow.xyEdges) ? matchedFlow.xyEdges : (Array.isArray(matchedFlow.edges) ? matchedFlow.edges : [])

  let nodesToExecute: any[] = []

  // If edges exist, traverse from the button or trigger node using BFS to support both chains & branching!
  if (edges.length > 0 && allNodes.length > 0) {
    const cleanBtnText = (buttonReplyTitle || buttonReplyId || '').toLowerCase()
    let startEdges = edges.filter((e: any) => {
      const handle = (e.sourceHandle || '').toLowerCase()
      return handle.includes('btn') && (cleanBtnText.includes('interest') ? handle.includes('interest') : true)
    })

    if (startEdges.length === 0) {
      // Find edges leaving the trigger node
      const triggerNode = allNodes.find((n: any) => n.type === 'triggerNode' || n.type?.startsWith('trigger_'))
      if (triggerNode) {
        startEdges = edges.filter((e: any) => e.source === triggerNode.id)
      }
    }
    if (startEdges.length === 0 && edges.length > 0) {
      startEdges = [edges[0]]
    }

    const queue = startEdges.map((e: any) => e.target).filter(Boolean)
    const visited = new Set<string>()

    while (queue.length > 0) {
      const targetId = queue.shift()
      if (!targetId || visited.has(targetId)) continue
      visited.add(targetId)

      const targetNode = allNodes.find((n: any) => n.id === targetId)
      if (targetNode) {
        nodesToExecute.push(targetNode)
      }

      const nextEdges = edges.filter((e: any) => e.source === targetId)
      for (const ne of nextEdges) {
        if (!visited.has(ne.target)) {
          queue.push(ne.target)
        }
      }
    }
  }

  // Fallback: execute all non-trigger nodes in sequence
  if (nodesToExecute.length === 0) {
    nodesToExecute = allNodes.filter((n: any) => n.type !== 'triggerNode')
  }

  const actionsExecuted: string[] = []
  const metaUrl = `https://graph.facebook.com/v20.0/${ownerWaPhoneId}/messages`

  // Execute each node in the flow sequentially
  for (const node of nodesToExecute) {
    const nodeType = node.type
    const cfg = node.data || node.config || {}

    console.log(`[FlowRunner] Executing node: ${node.data?.title || node.title || nodeType} (${nodeType})`)

    try {
      // A. MANYCHAT ACTION NODE (Multi-Action: Notify Admin + Set CRM Stage + Add Tag)
      if (nodeType === 'actionNode') {
        const actionsList = Array.isArray(node.data?.actions) ? node.data.actions : []
        for (const act of actionsList) {
          if (act.type === 'notify_admin') {
            const rawTitle = '🔥 Lead Clicked Interested on WhatsApp Broadcast!'
            const rawBody = 'Prospect {{lead_name}} ({{lead_phone}}) clicked "{{button_title}}" for {{business_name}}! Follow up now.'
            const alertVars = { ...variableMap, button_title: buttonReplyTitle || 'Interested' }
            const title = interpolateVariables(rawTitle, alertVars)
            const body = interpolateVariables(rawBody, alertVars)
            const targetLeadId = latestLead?.id
            const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm'

            await sendAdminMultiChannelNotification({
              ownerUserId,
              title,
              body,
              url: targetUrl,
              type: 'lead_interest',
              leadPhone,
              leadName,
              leadId: targetLeadId
            })
            actionsExecuted.push('notify_admin')
          } else if (act.type === 'crm_stage') {
            const stageName = act.stage || 'Interested'
            if (latestLead?.id) {
              await supabaseAdmin.from('leads').update({ pipeline_stage: stageName }).eq('id', latestLead.id)
              actionsExecuted.push(`update_stage:${stageName}`)
            }
          } else if (act.type === 'add_tag') {
            const tagVal = act.tag || 'Interested Lead'
            if (latestLead?.id) {
              const currentTags = Array.isArray(latestLead.tags) ? latestLead.tags : []
              if (!currentTags.includes(tagVal)) {
                await supabaseAdmin.from('leads').update({ tags: [...currentTags, tagVal] }).eq('id', latestLead.id)
                actionsExecuted.push(`add_tag:${tagVal}`)
              }
            }
          }
        }
      }

      // B. MANYCHAT INVENTORY DELIVERY NODE
      if (nodeType === 'inventoryDeliveryNode') {
        const rawBody = node.data?.message || 'Thank you for your interest! 🌟 Here is our verified property catalog:\n\n👉 {{inventory_url}}'
        const interpolatedBody = interpolateVariables(rawBody, variableMap)

        // Send CTA link interactive message to WhatsApp
        const ctaPayload = {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanFrom,
          type: 'interactive',
          interactive: {
            type: 'cta_url',
            body: { text: interpolatedBody },
            footer: { text: (ownerBusinessName || 'Property Advisory').slice(0, 60) },
            action: {
              name: 'cta_url',
              parameters: {
                display_text: 'Explore Inventory',
                url: inventoryUrl
              }
            }
          }
        }

        const res = await fetch(metaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ownerWaToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(ctaPayload)
        })

        if (!res.ok) {
          await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ownerWaToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: cleanFrom,
              type: 'text',
              text: { body: `${interpolatedBody}\n\n👉 ${inventoryUrl}` }
            })
          })
        }

        await supabaseAdmin.from('whatsapp_messages').insert({
          chat_id: chat.id,
          direction: 'outbound',
          message_text: interpolatedBody
        })

        actionsExecuted.push('deliver_inventory_link')
      }

      // C. MANYCHAT WHATSAPP MESSAGE NODE (with built-in automations & CTA buttons)
      if (nodeType === 'whatsappMessageNode') {
        const rawMsg = node.data?.message || ''
        const interpolated = interpolateVariables(rawMsg, variableMap)

        // 1. Trigger attached automations (Notify Admin)
        if (node.data?.notifyAdmin !== false) {
          const rawTitle = '🔥 Lead Clicked Interested on WhatsApp Broadcast!'
          const rawBody = 'Prospect {{lead_name}} ({{lead_phone}}) clicked "{{button_title}}" for {{business_name}}! Follow up now.'
          const alertVars = { ...variableMap, button_title: buttonReplyTitle || 'Interested' }
          const title = interpolateVariables(rawTitle, alertVars)
          const body = interpolateVariables(rawBody, alertVars)
          const targetLeadId = latestLead?.id
          const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm'

          await sendAdminMultiChannelNotification({
            ownerUserId,
            title,
            body,
            url: targetUrl,
            type: 'lead_interest',
            leadPhone,
            leadName,
            leadId: targetLeadId
          })
          actionsExecuted.push('notify_admin')
        }

        // 2. Trigger attached CRM Stage update
        if (node.data?.crmStage) {
          const stageName = node.data.crmStage
          if (latestLead?.id) {
            await supabaseAdmin.from('leads').update({ pipeline_stage: stageName }).eq('id', latestLead.id)
            actionsExecuted.push(`update_stage:${stageName}`)
          }
        }

        // 3. Trigger attached Tag
        if (node.data?.addTag) {
          const tagVal = node.data.addTag
          if (latestLead?.id) {
            const currentTags = Array.isArray(latestLead.tags) ? latestLead.tags : []
            if (!currentTags.includes(tagVal)) {
              await supabaseAdmin.from('leads').update({ tags: [...currentTags, tagVal] }).eq('id', latestLead.id)
              actionsExecuted.push(`add_tag:${tagVal}`)
            }
          }
        }

        // 4. Send Message (with CTA URL button if configured)
        const buttons = node.data?.buttons || []
        const ctaBtn = buttons.find((b: any) => b.url)

        if (ctaBtn) {
          const btnUrl = interpolateVariables(ctaBtn.url, variableMap) || inventoryUrl
          const ctaPayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanFrom,
            type: 'interactive',
            interactive: {
              type: 'cta_url',
              body: { text: interpolated },
              footer: { text: (ownerBusinessName || 'Property Advisory').slice(0, 60) },
              action: {
                name: 'cta_url',
                parameters: {
                  display_text: ctaBtn.title.slice(0, 20),
                  url: btnUrl
                }
              }
            }
          }

          const res = await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ownerWaToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(ctaPayload)
          })

          if (!res.ok) {
            await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${ownerWaToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanFrom,
                type: 'text',
                text: { body: `${interpolated}\n\n👉 ${btnUrl}` }
              })
            })
          }
        } else if (interpolated) {
          await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ownerWaToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: cleanFrom,
              type: 'text',
              text: { body: interpolated }
            })
          })
        }

        await supabaseAdmin.from('whatsapp_messages').insert({
          chat_id: chat.id,
          direction: 'outbound',
          message_text: interpolated
        })

        actionsExecuted.push('send_whatsapp_message')
      }

      // D. SEND EMAIL NODE (emailNode) & ACTION SEND EMAIL (action_send_email / action_email)
      if (nodeType === 'emailNode' || nodeType === 'action_send_email' || nodeType === 'action_email') {
        const rawSubject = cfg.subject || '🔥 New Interested Lead: {{lead_name}} ({{lead_phone}})'
        const subject = interpolateVariables(rawSubject, variableMap)

        let targetRecipient = (cfg.recipient || cfg.to || '').trim()
        if (targetRecipient) {
          targetRecipient = interpolateVariables(targetRecipient, variableMap)
        }

        // If recipient is empty, or evaluates to {{lead_email}} without lead having an email, or is set to owner_email / admin
        if (!targetRecipient || targetRecipient === '{{lead_email}}' || targetRecipient === 'all_admins' || targetRecipient === 'owner') {
          targetRecipient = ownerResolvedEmail || 'estatesbioque@gmail.com'
        }

        const rawBody = cfg.body || cfg.message || ''
        const customBody = rawBody ? interpolateVariables(rawBody, variableMap) : undefined

        const targetLeadId = latestLead?.id
        const targetCrmUrl = targetLeadId ? `${appUrl}/dashboard/crm?leadId=${targetLeadId}` : `${appUrl}/dashboard/crm`
        const targetChatUrl = chat?.id ? `${appUrl}/dashboard/whatsapp?chatId=${chat.id}` : `${appUrl}/dashboard/whatsapp`

        console.log(`[FlowRunner] 📧 Dispatching lead notification email to: ${targetRecipient} for lead ${leadName} (${leadPhone})`)

        await sendLeadNotificationEmail({
          to: targetRecipient,
          subject,
          leadName,
          leadPhone,
          businessName: ownerBusinessName,
          campaignName: matchedFlow.name || 'WhatsApp Broadcast Flow',
          buttonClicked: buttonReplyTitle || 'Interested',
          customBody,
          crmUrl: targetCrmUrl,
          chatUrl: targetChatUrl,
          bcc: ownerResolvedBcc
        })

        actionsExecuted.push(`send_email:${targetRecipient}`)
      }

      // 1. ACTION: Send WhatsApp Message (Text or CTA Link Button)
      if (nodeType === 'action_whatsapp_msg' || nodeType === 'action_send_whatsapp') {
        const rawBody = cfg.message || cfg.body || cfg.text || ''
        const interpolatedBody = interpolateVariables(rawBody, variableMap) || 
          `Thank you for your interest! 🌟 Here is our current property inventory and catalog:\n\n👉 ${inventoryUrl}`

        const buttonText = cfg.buttonText || cfg.ctaText || ''
        const rawButtonUrl = cfg.buttonUrl || cfg.ctaUrl || ''
        const interpolatedButtonUrl = rawButtonUrl ? interpolateVariables(rawButtonUrl, variableMap) : inventoryUrl

        // If CTA button is configured, send as interactive cta_url message
        if (buttonText && interpolatedButtonUrl) {
          const ctaPayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanFrom,
            type: 'interactive',
            interactive: {
              type: 'cta_url',
              header: cfg.header ? { type: 'text', text: interpolateVariables(cfg.header, variableMap).slice(0, 60) } : undefined,
              body: { text: interpolatedBody },
              footer: { text: (ownerBusinessName || 'Property Advisory').slice(0, 60) },
              action: {
                name: 'cta_url',
                parameters: {
                  display_text: buttonText.slice(0, 20),
                  url: interpolatedButtonUrl
                }
              }
            }
          }

          const res = await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ownerWaToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(ctaPayload)
          })

          if (!res.ok) {
            console.warn('[FlowRunner] CTA URL button send failed, falling back to clean text:', await res.json())
            // Fallback: send as direct text with link
            await fetch(metaUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${ownerWaToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanFrom,
                type: 'text',
                text: { body: `${interpolatedBody}\n\n👉 ${interpolatedButtonUrl}` }
              })
            })
          }
        } else {
          // Send plain text message
          await fetch(metaUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ownerWaToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: cleanFrom,
              type: 'text',
              text: { body: interpolatedBody }
            })
          })
        }

        // Log outbound message to database
        await supabaseAdmin.from('whatsapp_messages').insert({
          chat_id: chat.id,
          direction: 'outbound',
          message_text: interpolatedBody
        })

        await supabaseAdmin.from('whatsapp_chats').update({
          last_message_text: interpolatedBody,
          updated_at: new Date().toISOString()
        }).eq('id', chat.id)

        actionsExecuted.push('send_whatsapp_message')
      }

      // 2. ACTION: Notify Admin / Multi-Channel Alert
      if (nodeType === 'action_notify_team' || nodeType === 'action_notify_admin') {
        const rawTitle = cfg.title || '🔥 Lead Clicked Interested on WhatsApp Broadcast!'
        const rawBody = cfg.body || 'Prospect {{lead_name}} ({{lead_phone}}) clicked "{{button_title}}" for {{business_name}}! Follow up now.'

        const alertVars = {
          ...variableMap,
          button_title: buttonReplyTitle || 'Interested'
        }

        const title = interpolateVariables(rawTitle, alertVars)
        const body = interpolateVariables(rawBody, alertVars)

        const targetLeadId = latestLead?.id
        const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm'

        await sendAdminMultiChannelNotification({
          ownerUserId,
          title,
          body,
          url: targetUrl,
          type: 'lead_interest',
          leadPhone,
          leadName,
          leadId: targetLeadId
        })

        actionsExecuted.push('notify_admin')
      }

      // 3. ACTION: Update CRM Stage (crmStageNode or action_crm_stage)
      if (nodeType === 'crmStageNode' || nodeType === 'action_crm_stage') {
        const targetStage = cfg.stage || cfg.pipeline_stage || 'Interested'
        if (latestLead?.id) {
          const leadUpdates: Record<string, any> = { pipeline_stage: targetStage }
          if (cfg.assignAgent) {
            leadUpdates.assigned_to_name = cfg.assignAgent
          }
          if (cfg.note) {
            const existingCf = latestLead.custom_fields || {}
            leadUpdates.custom_fields = {
              ...existingCf,
              flow_note: cfg.note
            }
          }
          await supabaseAdmin
            .from('leads')
            .update(leadUpdates)
            .eq('id', latestLead.id)

          actionsExecuted.push(`update_stage:${targetStage}`)
        }
      }

      // 4. ACTION: Notify Admin / Multi-Channel Alert (notifyNode or action_notify_team)
      if (nodeType === 'notifyNode' || nodeType === 'action_notify_team' || nodeType === 'action_notify_admin') {
        const rawTitle = cfg.title || '🔥 Lead Engaged with Automation Flow!'
        const rawBody = cfg.message || cfg.body || 'Prospect {{lead_name}} ({{lead_phone}}) engaged with automation for {{business_name}}!'
        const title = interpolateVariables(rawTitle, variableMap)
        const body = interpolateVariables(rawBody, variableMap)
        const targetLeadId = latestLead?.id
        const targetUrl = targetLeadId ? `/dashboard/crm?leadId=${targetLeadId}` : '/dashboard/crm'

        await sendAdminMultiChannelNotification({
          ownerUserId,
          title,
          body,
          url: targetUrl,
          type: 'lead_interest',
          leadPhone,
          leadName,
          leadId: targetLeadId
        })

        // If channels includes email or recipient is custom email, dispatch email notification
        const channels: string[] = Array.isArray(cfg.channels) ? cfg.channels : (cfg.channels ? [cfg.channels] : [])
        if (channels.includes('email') || cfg.recipient === 'custom' || cfg.customRecipient?.includes('@')) {
          let emailTo = cfg.recipient === 'custom' && cfg.customRecipient ? cfg.customRecipient.trim() : ownerResolvedEmail
          emailTo = interpolateVariables(emailTo, variableMap)
          if (!emailTo && ownerResolvedEmail) emailTo = ownerResolvedEmail
          if (emailTo) {
            await sendLeadNotificationEmail({
              to: emailTo,
              subject: title,
              leadName,
              leadPhone,
              businessName: ownerBusinessName,
              campaignName: matchedFlow.name,
              buttonClicked: buttonReplyTitle || 'Interested',
              customBody: body,
              crmUrl: `${appUrl}${targetUrl}`,
              bcc: ownerResolvedBcc
            })
            actionsExecuted.push(`notify_email:${emailTo}`)
          }
        }

        actionsExecuted.push('notify_team')
      }

      // 5. ACTION: Custom API / Webhook Integration (customApiNode or action_webhook)
      if (nodeType === 'customApiNode' || nodeType === 'action_webhook') {
        const targetUrl = cfg.url
        const method = (cfg.method || 'POST').toUpperCase()
        if (targetUrl) {
          try {
            const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
            if (Array.isArray(cfg.headers)) {
              cfg.headers.forEach((h: any) => {
                if (h.key && h.value) {
                  reqHeaders[h.key] = interpolateVariables(h.value, variableMap)
                }
              })
            }
            const reqBody = cfg.body 
              ? interpolateVariables(cfg.body, variableMap) 
              : JSON.stringify({
                  lead_id: latestLead?.id,
                  name: leadName,
                  phone: leadPhone,
                  business_name: ownerBusinessName,
                  source: 'whatsapp_automation',
                  timestamp: new Date().toISOString()
                })

            await fetch(targetUrl, {
              method,
              headers: reqHeaders,
              body: method !== 'GET' ? reqBody : undefined
            })
            actionsExecuted.push(`webhook:${method}:${targetUrl.slice(0, 30)}`)
          } catch (apiErr) {
            console.error('[FlowRunner] Error dispatching custom API webhook:', apiErr)
          }
        }
      }

      // 6. ACTION: AI Voice Call (aiCallNode or action_ai_call)
      if (nodeType === 'aiCallNode' || nodeType === 'action_ai_call') {
        if (latestLead?.id) {
          try {
            const { triggerOutboundCall } = await import('@/utils/voice-helper')
            await triggerOutboundCall(supabaseAdmin, latestLead.id, ownerUserId, true)
            actionsExecuted.push('trigger_ai_call')
          } catch (callErr) {
            console.error('[FlowRunner] Error triggering AI voice call:', callErr)
          }
        }
      }

      // 7. ACTION: Add / Manage CRM Tags (tagNode or action_add_tag)
      if (nodeType === 'tagNode' || nodeType === 'action_add_tag') {
        const rawTags = cfg.tags || (cfg.tag ? [cfg.tag] : ['Interested'])
        const tagsToAdd = Array.isArray(rawTags) ? rawTags : [String(rawTags)]
        if (latestLead?.id && tagsToAdd.length > 0) {
          const currentTags = Array.isArray(latestLead.tags) ? latestLead.tags : []
          const merged = Array.from(new Set([...currentTags, ...tagsToAdd]))
          await supabaseAdmin
            .from('leads')
            .update({ tags: merged })
            .eq('id', latestLead.id)

          actionsExecuted.push(`add_tags:${tagsToAdd.join(',')}`)
        }
      }

      // 8. ACTION: Update Custom Field
      if (nodeType === 'action_update_field') {
        const fieldName = cfg.field || cfg.key || 'interested_clicked'
        const fieldValue = cfg.value !== undefined ? cfg.value : true

        if (latestLead?.id) {
          const updatedCustom = {
            ...(latestLead.custom_fields || {}),
            [fieldName]: fieldValue,
            interested_at: new Date().toISOString()
          }

          await supabaseAdmin
            .from('leads')
            .update({ custom_fields: updatedCustom })
            .eq('id', latestLead.id)

          actionsExecuted.push(`update_field:${fieldName}`)
        }
      }

      // Optional delay between nodes if configured
      if (nodeType === 'action_delay' || nodeType === 'delayNode') {
        const delaySeconds = Math.min(cfg.seconds || (cfg.minutes ? cfg.minutes * 60 : 1), 10)
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))
        actionsExecuted.push(`delay:${delaySeconds}s`)
      }

    } catch (nodeErr) {
      console.error(`[FlowRunner] Error executing node ${nodeType}:`, nodeErr)
    }
  }

  // Increment flow run stats in automations table
  try {
    if (matchedFlowRecordId) {
      const currentStats = matchedFlow.stats || { runs: 0, completed: 0 }
      currentStats.runs = (currentStats.runs || 0) + 1
      currentStats.completed = (currentStats.completed || 0) + 1
      currentStats.lastTriggeredAt = new Date().toISOString()

      await supabaseAdmin
        .from('automations')
        .update({
          stats: JSON.stringify(currentStats)
        })
        .eq('id', matchedFlowRecordId)
    }
  } catch (statsErr) {
    console.error('[FlowRunner] Error updating flow stats:', statsErr)
  }

  console.log(`[FlowRunner] ✅ Completed execution for flow "${matchedFlow.name}". Actions executed:`, actionsExecuted)

  return {
    handled: true,
    flowId: matchedFlowRecordId || undefined,
    flowName: matchedFlow.name,
    actionsExecuted
  }
}
