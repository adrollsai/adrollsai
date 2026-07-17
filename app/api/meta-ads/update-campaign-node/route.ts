import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0"

export async function POST(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const impersonateId = url.searchParams.get('impersonate')

  const { nodeId, type, fields } = await request.json()

  if (!nodeId || !type || !fields) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single()
  
  let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
    ? (profile.agency_id || profile.parent_id) 
    : user.id

  if (impersonateId && impersonateId !== user.id) {
      if (['super_admin', 'agency', 'admin', 'agent'].includes(profile?.role || '')) {
          if (profile?.role !== 'super_admin') {
              const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
              const { data: subAccount } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', impersonateId)
                .eq('agency_id', profile?.agency_id || user.id)
                .single()

              if (isParent || subAccount) {
                  targetUserId = impersonateId
              } else {
                  return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
              }
          } else {
              targetUserId = impersonateId
          }
      } else {
          return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
      }
  }

  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('facebook_token, ad_account_id, agency_id, parent_id')
    .eq('id', targetUserId)
    .single()

  let token = targetProfile?.facebook_token
  if (!token) {
      token = profile?.facebook_token
  }

  if (!token && (profile?.agency_id || profile?.parent_id)) {
      const { data: parentProfile } = await supabase
          .from('profiles')
          .select('facebook_token')
          .eq('id', profile.agency_id || profile.parent_id)
          .single()
      token = parentProfile?.facebook_token
  }

  if (!token) {
    return NextResponse.json({ error: 'Meta Ad Account not fully connected.' }, { status: 400 })
  }

  const adAccountId = targetProfile?.ad_account_id

  try {
    let creativeId = fields.creative?.id;

    // Check if we need to create a new creative (if any copy, image, or form changes)
    if (fields.creative && (fields.creative.imageUrl || fields.creative.primaryText || fields.creative.headline || fields.creative.description || fields.creative.leadFormId)) {
      let imageHash = fields.creative.imageHash;
      const imageUrl = fields.creative.imageUrl;

      let videoId = null;

      if (fields.creative.isVideo) {
        // Video upload to Meta
        const videoUrl = fields.creative.imageUrl;
        if (videoUrl) {
          try {
            console.log(`[Update Campaign Node] Uploading video via Meta file_url: ${videoUrl}`);
            const videoRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/advideos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_url: videoUrl,
                access_token: token
              })
            });
            const videoResult = await videoRes.json();
            if (videoResult.id) {
              videoId = videoResult.id;
              console.log(`[Update Campaign Node] Successfully uploaded video. Meta ID: ${videoId}`);
            } else {
              console.error("[Update Campaign Node] file_url upload failed:", videoResult.error);
            }
          } catch (err: any) {
            console.error("[Update Campaign Node] file_url upload error:", err.message);
          }

          if (!videoId) {
            try {
              console.log(`[Update Campaign Node] Falling back to downloading video for binary upload: ${videoUrl}`);
              const videoFetch = await fetch(videoUrl);
              if (videoFetch.ok) {
                const videoBlob = await videoFetch.blob();
                const videoData = new FormData();
                videoData.append('source', videoBlob, 'video.mp4');
                videoData.append('access_token', token);
                const videoRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/advideos`, {
                  method: 'POST',
                  body: videoData
                });
                const videoResult = await videoRes.json();
                if (videoResult.id) {
                  videoId = videoResult.id;
                  console.log(`[Update Campaign Node] Successfully uploaded video via binary fallback. Meta ID: ${videoId}`);
                } else {
                  console.error("[Update Campaign Node] Binary upload failed:", videoResult.error);
                }
              }
            } catch (err: any) {
              console.error("[Update Campaign Node] Binary upload error:", err.message);
            }
          }
        }
      } else {
        // Only upload image if not a video
        if (imageUrl && !imageHash) {
          try {
            const imageFetch = await fetch(imageUrl);
            if (imageFetch.ok) {
              const imageBlob = await imageFetch.blob();
              const uploadFormData = new FormData();
              uploadFormData.append('source', imageBlob, 'marketing_asset.png');
              uploadFormData.append('access_token', token);
              
              const uploadRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/adimages`, {
                method: 'POST',
                body: uploadFormData
              });
              const uploadData = await uploadRes.json();
              if (uploadData.images) {
                imageHash = uploadData.images[Object.keys(uploadData.images)[0]].hash;
              }
            }
          } catch (err: any) {
            console.error("Fetching & Uploading image URL failed:", err.message);
          }
        }
      }

      const ctaValue: any = {};
      if (fields.creative.leadFormId) {
        ctaValue.lead_gen_form_id = fields.creative.leadFormId;
      }
      if (fields.creative.linkUrl) {
        ctaValue.link = fields.creative.linkUrl;
      } else {
        ctaValue.link = "https://adrolls.in";
      }

      const creativePayload: any = {
        name: `Edited Creative - ${Date.now()}`,
        object_story_spec: {
          page_id: fields.creative.pageId, 
        },
        access_token: token,
      };

      if (fields.creative.isVideo && videoId) {
        creativePayload.object_story_spec.video_data = {
          video_id: videoId,
          message: fields.creative.primaryText || "Exclusive Property Deal. View pricing & details now.", 
          title: fields.creative.headline || "View Details", 
          image_hash: imageHash, 
          call_to_action: { 
            type: 'LEARN_MORE', 
            value: ctaValue
          }
        };
      } else {
        creativePayload.object_story_spec.link_data = {
          message: fields.creative.primaryText || "Exclusive Property Deal. View pricing & details now.", 
          name: fields.creative.headline || "View Details", 
          description: fields.creative.description || "",
          link: fields.creative.linkUrl || "https://adrolls.in", 
          image_hash: imageHash, 
          call_to_action: { 
            type: 'LEARN_MORE', 
            value: ctaValue
          }
        };
      }

      const creativeRes = await fetch(`${FB_GRAPH_URL}/${adAccountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creativePayload),
      });
      const creativeData = await creativeRes.json();
      
      if (!creativeRes.ok) {
        throw new Error(`Creative Update Error: ${creativeData.error?.message || "Failed to create ad creative"}`);
      }
      creativeId = creativeData.id;
    }

    // Construct request body for updating node
    const updateBody: any = {
      access_token: token
    }

    if (fields.name !== undefined) {
      updateBody.name = fields.name;
    }

    if (fields.status !== undefined) {
      updateBody.status = fields.status;
    }

    if (creativeId) {
      updateBody.creative = { creative_id: creativeId };
    }

    if (fields.targeting !== undefined) {
      if (type === 'adset') {
        const adsetRes = await fetch(`${FB_GRAPH_URL}/${nodeId}?fields=targeting&access_token=${token}`);
        const adsetData = await adsetRes.json();
        if (adsetData.error) {
          throw new Error(`Failed to fetch current ad set targeting: ${adsetData.error.message}`);
        }
        
        const currentTargeting = adsetData.targeting || {};
        const currentGeo = currentTargeting.geo_locations || {};
        const newGeo = fields.targeting.geo_locations || {};
        
        const updatedGeo: any = {
          ...newGeo
        };


        if (currentGeo.custom_audiences) {
          updatedGeo.custom_audiences = currentGeo.custom_audiences;
        }
        if (currentGeo.excluded_custom_audiences) {
          updatedGeo.excluded_custom_audiences = currentGeo.excluded_custom_audiences;
        }

        // Clean up locations to use raw structure Meta expects on updates
        if (updatedGeo.cities) {
          updatedGeo.cities = updatedGeo.cities.map((c: any) => ({
            key: c.key,
            radius: c.radius || 20,
            distance_unit: c.distance_unit || 'kilometer'
          }));
        }
        if (updatedGeo.regions) {
          let regionsList = updatedGeo.regions;
          // De-conflict Chandigarh Region (1726) with Chandigarh City (1021145)
          const hasChandigarhCity = updatedGeo.cities && updatedGeo.cities.some((c: any) => c.key === '1021145');
          if (hasChandigarhCity) {
            regionsList = regionsList.filter((r: any) => r.key !== '1726');
          }
          updatedGeo.regions = regionsList.map((r: any) => ({ key: r.key }));
        }
        if (updatedGeo.zips) {
          updatedGeo.zips = updatedGeo.zips.map((z: any) => ({ key: z.key }));
        }

        updateBody.targeting = {
          ...currentTargeting,
          geo_locations: updatedGeo
        };
      } else {
        updateBody.targeting = fields.targeting;
      }
    }

    if (fields.budget !== undefined) {
      const budgetCents = Math.round(parseFloat(fields.budget) * 100);
      if (fields.budgetType === 'lifetime') {
        updateBody.lifetime_budget = budgetCents;
      } else {
        updateBody.daily_budget = budgetCents;
      }
    }

    const fbUrl = `${FB_GRAPH_URL}/${nodeId}`;
    const response = await fetch(fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody)
    });

    const data = await response.json();

    if (data.error) {
      console.error(`Meta Node Update Error (${type}):`, data.error);
      throw new Error(data.error.message);
    }

    return NextResponse.json({
      success: true,
      message: `${type.toUpperCase()} node updated successfully.`
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
