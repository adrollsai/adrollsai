const fs = require('fs');

const file = 'app/api/webhooks/facebook/route.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Ensure import of createCreativeSessionToken
if (!content.includes("import { createCreativeSessionToken } from '@/utils/creative-token'")) {
  content = content.replace(
    "import { deductCreditsByCost, calculateLLMCost } from '@/utils/credits'",
    "import { deductCreditsByCost, calculateLLMCost } from '@/utils/credits'\nimport { createCreativeSessionToken } from '@/utils/creative-token'"
  );
}

// 2. Replace the tool send_creative_picker_flow with send_creative_picker
const oldToolRegex = /send_creative_picker_flow:\s*tool\(\{[\s\S]*?\}\),\s*launch_meta_campaign:/;

const newToolContent = `send_creative_picker: tool({
                                        description: "Sends an interactive WhatsApp message with a secure link and CTA button that opens the mobile-first Creative Picker webview directly inside WhatsApp. The webview lets the user view full image/video previews, filter by category (Images, Videos, AI Generated) and aspect ratio (1:1, 9:16), upload new files from their phone, and multi-select items. Call this whenever the user asks to see, choose, filter, or select creatives for a campaign.",
                                        inputSchema: z.object({
                                          campaign_job_id: z.string().optional().describe("Optional campaign draft ID to attach the selected creatives to.")
                                        }),
                                        execute: async (args: { campaign_job_id?: string }) => {
                                          try {
                                            console.log(\`🎨 [TOOL: send_creative_picker] Triggered for user \${matchedProfile.id}\`);

                                            let targetJobId = args.campaign_job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id, payload')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            // Generate secure session token (valid for 48 hours)
                                            const token = createCreativeSessionToken({
                                              userId: matchedProfile.id,
                                              campaignId: targetJobId,
                                              phone: cleanFrom
                                            });

                                            // Base URL for webview (use production app URL or current domain)
                                            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.nobogent.com';
                                            const pickerUrl = \`\${baseUrl.replace(/\\/$/, '')}/select-creatives?token=\${token}\`;

                                            const targetPhoneId = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_PHONE_ID || wabaPhoneId || matchedProfile.whatsapp_phone_number_id)
                                              : (wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);
                                            const targetToken = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                              : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);

                                            // Send interactive CTA URL message to WhatsApp
                                            const msgPayload = {
                                              messaging_product: 'whatsapp',
                                              recipient_type: 'individual',
                                              to: cleanFrom,
                                              type: 'interactive',
                                              interactive: {
                                                type: 'cta_url',
                                                header: {
                                                  type: 'text',
                                                  text: '🎨 Select Campaign Creatives'
                                                },
                                                body: {
                                                  text: \`Tap the button below to view full visual previews of your creatives, filter by Images, Videos & AI, or upload new files from your phone gallery.\\n\\n🔗 *Direct Link:*\\n\${pickerUrl}\`
                                                },
                                                footer: {
                                                  text: 'Nobogent AI'
                                                },
                                                action: {
                                                  name: 'cta_url',
                                                  parameters: {
                                                    display_text: 'Browse & Select Creatives 🖼️',
                                                    url: pickerUrl
                                                  }
                                                }
                                              }
                                            };

                                            const sendRes = await fetch(\`https://graph.facebook.com/v20.0/\${targetPhoneId}/messages\`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': \`Bearer \${targetToken}\`,
                                                'Content-Type': 'application/json'
                                              },
                                              body: JSON.stringify(msgPayload)
                                            });

                                            const sendData = await sendRes.json();
                                            if (!sendRes.ok) {
                                              console.warn('[send_creative_picker] CTA URL failed, sending text fallback:', sendData);
                                              // Fallback to standard formatted text message with link
                                              await fetch(\`https://graph.facebook.com/v20.0/\${targetPhoneId}/messages\`, {
                                                method: 'POST',
                                                headers: {
                                                  'Authorization': \`Bearer \${targetToken}\`,
                                                  'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                  messaging_product: 'whatsapp',
                                                  recipient_type: 'individual',
                                                  to: cleanFrom,
                                                  type: 'text',
                                                  text: {
                                                    body: \`🎨 *Select Your Campaign Creatives*\\n\\nTap the link below to open your creative gallery directly in WhatsApp. You can preview high-res images, filter by video/image/AI, upload new photos, and multi-select:\\n\\n👉 \${pickerUrl}\\n\\nOnce selected, tap 'Attach to Campaign' and I'll update your campaign automatically!\`
                                                  }
                                                })
                                              });
                                            }

                                            return {
                                              success: true,
                                              picker_url: pickerUrl,
                                              message: "Sent interactive Creative Picker link to the user's WhatsApp. They can tap to open the visual gallery, filter, preview, and multi-select."
                                            };
                                          } catch (e: any) {
                                            console.error('❌ [send_creative_picker] Error:', e);
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),\n                                      launch_meta_campaign:`;

if (oldToolRegex.test(content)) {
  content = content.replace(oldToolRegex, newToolContent);
  console.log('Replaced old tool with send_creative_picker');
} else {
  console.log('Regex did not match old tool, inspecting...');
}

// 3. Update prompt references
content = content.replace(
  "- Use 'send_creative_picker_flow' to send an interactive WhatsApp screen with checkboxes allowing the user to visually browse and multi-select creatives from their library directly inside WhatsApp!",
  "- Use 'send_creative_picker' to send an in-app visual picker link allowing the user to browse high-res previews, filter by category/aspect ratio, and multi-select creatives directly inside WhatsApp's built-in browser."
);

fs.writeFileSync(file, content, 'utf8');
console.log('Updated route.ts successfully');
