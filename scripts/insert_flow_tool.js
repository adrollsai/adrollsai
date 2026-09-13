const fs = require('fs');

const file = 'app/api/webhooks/facebook/route.ts';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `                                      list_user_creatives: tool({`;

const newTool = `                                      send_creative_picker_flow: tool({
                                        description: "Sends actual visual media previews (photos/videos) directly to WhatsApp chat first, followed immediately by an interactive multi-select WhatsApp Flow button. Call this whenever the user asks to see, preview, choose, or select creatives from their library.",
                                        inputSchema: z.object({
                                          campaign_job_id: z.string().optional().describe("Optional campaign draft ID to attach the selected creatives to.")
                                        }),
                                        execute: async (args: { campaign_job_id?: string }) => {
                                          try {
                                            console.log(\`🎨 [TOOL: send_creative_picker_flow] Triggered for user \${matchedProfile.id}\`);
                                            const { data: assets } = await supabaseAdmin
                                              .from('assets')
                                              .select('id, url, caption, type, created_at')
                                              .eq('user_id', matchedProfile.id)
                                              .order('created_at', { ascending: false })
                                              .limit(5);

                                            if (!assets || assets.length === 0) {
                                              return {
                                                success: false,
                                                message: "No creatives found in your asset library yet. You can upload an image here in chat or ask me to generate one with AI."
                                              };
                                            }

                                            const targetPhoneId = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_PHONE_ID || wabaPhoneId || matchedProfile.whatsapp_phone_number_id)
                                              : (wabaPhoneId || matchedProfile.whatsapp_phone_number_id || process.env.DEV_WHATSAPP_PHONE_ID);
                                            const targetToken = isMessageToOfficialBot
                                              ? (process.env.DEV_WHATSAPP_ACCESS_TOKEN || matchedProfile.whatsapp_access_token || matchedProfile.facebook_token)
                                              : (matchedProfile.whatsapp_access_token || matchedProfile.facebook_token || process.env.DEV_WHATSAPP_ACCESS_TOKEN);

                                            // 1. Send each visual preview directly to WhatsApp chat first!
                                            for (let i = 0; i < assets.length; i++) {
                                              const asset = assets[i];
                                              const isVideo = (asset.type || '').toLowerCase() === 'video' || asset.url.includes('.mp4');
                                              const mediaType = isVideo ? 'video' : 'image';
                                              const shortTitle = (asset.caption || \`Creative #\${i + 1}\`).substring(0, 50).trim();

                                              try {
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
                                                    type: mediaType,
                                                    [mediaType]: {
                                                      link: asset.url,
                                                      caption: \`\${isVideo ? '🎥' : '🖼️'} *[#\${i + 1}]* \${shortTitle}\`
                                                    }
                                                  })
                                                });
                                              } catch (mediaSendErr) {
                                                console.error(\`Failed to send preview #\${i + 1}:\`, mediaSendErr);
                                              }
                                            }

                                            // 2. Build and send the multi-select WhatsApp Flow
                                            const items = assets.map((a: any, idx: number) => ({
                                              id: a.url,
                                              title: \`[#\${idx + 1}] \${(a.caption || \`Creative #\${idx + 1}\`).substring(0, 25).trim()}\`,
                                              description: \`\${(a.type || 'Image').toUpperCase()} • \${a.url.slice(-20)}\`
                                            }));

                                            let targetJobId = args.campaign_job_id;
                                            if (!targetJobId) {
                                              const { data: latestDraft } = await supabaseAdmin
                                                .from('campaign_jobs')
                                                .select('id')
                                                .eq('user_id', matchedProfile.id)
                                                .eq('status', 'draft')
                                                .order('created_at', { ascending: false })
                                                .limit(1)
                                                .maybeSingle();
                                              if (latestDraft) targetJobId = latestDraft.id;
                                            }

                                            const flowToken = targetJobId ? \`campaign_\${targetJobId}\` : \`user_\${matchedProfile.id}\`;
                                            const flowId = '854097601031672';

                                            const flowPayload = {
                                              messaging_product: 'whatsapp',
                                              recipient_type: 'individual',
                                              to: cleanFrom,
                                              type: 'interactive',
                                              interactive: {
                                                type: 'flow',
                                                header: {
                                                  type: 'text',
                                                  text: '🎨 Choose Campaign Creatives'
                                                },
                                                body: {
                                                  text: \`Review the \${items.length} preview(s) above, then tap below to select which ones to attach to your campaign.\`
                                                },
                                                footer: {
                                                  text: 'Nobogent AI'
                                                },
                                                action: {
                                                  name: 'flow',
                                                  parameters: {
                                                    flow_message_version: '3',
                                                    flow_token: flowToken,
                                                    flow_id: flowId,
                                                    flow_cta: \`Select Creatives (\${items.length})\`,
                                                    flow_action: 'navigate',
                                                    flow_action_payload: {
                                                      screen: 'CHOOSE_CREATIVES',
                                                      data: {
                                                        creatives: items
                                                      }
                                                    }
                                                  }
                                                }
                                              }
                                            };

                                            await fetch(\`https://graph.facebook.com/v20.0/\${targetPhoneId}/messages\`, {
                                              method: 'POST',
                                              headers: {
                                                'Authorization': \`Bearer \${targetToken}\`,
                                                'Content-Type': 'application/json'
                                              },
                                              body: JSON.stringify(flowPayload)
                                            });

                                            return {
                                              success: true,
                                              items_count: items.length,
                                              message: \`Sent \${items.length} media previews to chat and opened the interactive selection Flow. The user can either tap the button to select with checkboxes, or reply with numbers (e.g. 'Use 1 and 2').\`
                                            };
                                          } catch (e: any) {
                                            console.error('❌ [send_creative_picker_flow] Exception:', e);
                                            return { success: false, error: e.message };
                                          }
                                        }
                                      }),\n` + targetStr;

if (!content.includes('send_creative_picker_flow: tool({')) {
  content = content.replace(targetStr, newTool);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully added send_creative_picker_flow to route.ts');
} else {
  console.log('Already exists');
}
