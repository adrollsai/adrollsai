import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchLeadForms } from '@/utils/external-apis'
import { logToFile } from '@/utils/logger'

export async function GET(request: Request) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve Target User ID
  const url = new URL(request.url);
  const impersonateId = url.searchParams.get('impersonate');
  const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
  let targetUserId = user.id;

  if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
      targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
  }

  if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
      if (ownProfile?.role !== 'super_admin') {
          const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
          if (subAccount) targetUserId = impersonateId;
          else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
      } else {
          targetUserId = impersonateId;
      }
  }

  // Get Page Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', targetUserId)
    .single()

  if (!profile?.selected_page_token || !profile?.selected_page_id) {
    return NextResponse.json({ error: 'Target account has no Page connected' }, { status: 400 })
  }

  try {
    const forms = await fetchLeadForms(profile.selected_page_token, profile.selected_page_id)
    return NextResponse.json({ forms })
  } catch (error: any) {
    console.error("Fetch Forms Error:", error);
    logToFile("❌ Fetch Lead Forms Failed:", error.message || error);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url);
    const impersonateId = url.searchParams.get('impersonate');
    const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
    let targetUserId = user.id;

    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
        targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
        if (ownProfile?.role !== 'super_admin') {
            const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
            if (subAccount) targetUserId = impersonateId;
            else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
        } else {
            targetUserId = impersonateId;
        }
    }

    const { pageId, name, customQuestions, privacyPolicyUrl, linkUrl } = await request.json();

    if (!pageId || !name) {
      return NextResponse.json({ error: 'Missing pageId or name parameters' }, { status: 400 });
    }

    // Get Page Credentials
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_page_token, selected_page_id, custom_domain')
      .eq('id', targetUserId)
      .single()

    if (!profile?.selected_page_token || !profile?.selected_page_id) {
      return NextResponse.json({ error: 'Target account has no Page connected' }, { status: 400 })
    }

    let metaCustomQuestions: any[] = [];
    if (customQuestions && Array.isArray(customQuestions)) {
        metaCustomQuestions = customQuestions.map((q: any) => {
            const label = q.label.trim();
            const lowerLabel = label.toLowerCase();
            
            if (q.type !== 'MULTIPLE_CHOICE') {
                if (lowerLabel.includes('company') || lowerLabel.includes('business name')) {
                    return { type: 'COMPANY_NAME', key: 'company_name' };
                }
                if (lowerLabel.includes('job title') || lowerLabel.includes('designation')) {
                    return { type: 'JOB_TITLE', key: 'job_title' };
                }
                if (lowerLabel.includes('city')) {
                    return { type: 'CITY', key: 'city' };
                }
                if (lowerLabel.includes('state')) {
                    return { type: 'STATE', key: 'state' };
                }
            }

            const metaQ: any = { 
                type: 'CUSTOM', 
                label: label.substring(0, 200) 
            };
            
            if (q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options)) {
                const validOptions = q.options
                    .filter((o: string) => o.trim() !== '')
                    .map((opt: string) => ({ 
                        value: opt.trim(),
                        key: opt.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)
                    }));
                    
                if (validOptions.length > 0) {
                    metaQ.options = validOptions;
                }
            }
            return metaQ;
        });

        const seenTypes = new Set(['FULL_NAME', 'EMAIL', 'PHONE']);
        metaCustomQuestions = metaCustomQuestions.filter(q => {
            if (q.type === 'CUSTOM') return true;
            if (seenTypes.has(q.type)) return false;
            seenTypes.add(q.type);
            return true;
        });
    }

    const domain = profile.custom_domain || 'adrolls.in';
    const finalPrivacyUrl = privacyPolicyUrl || `https://${domain}/privacy`;
    const finalFollowUpUrl = linkUrl || `https://${domain}`;

    const leadFormPayload: any = {
        name,
        follow_up_action_url: finalFollowUpUrl,
        question_page_custom_headline: `Get Pricing & Details`,
        question_page_custom_text: "Confirm details to view pricing.",
        privacy_policy: { 
            url: finalPrivacyUrl, 
            link_text: "Privacy Policy" 
        },
        questions: [
            { type: "FULL_NAME", key: "full_name" },
            { type: "EMAIL", key: "email" },
            { type: "PHONE", key: "phone_number" },
            ...metaCustomQuestions
        ],
        access_token: profile.selected_page_token
    };

    const formCreateRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(leadFormPayload)
    });
    
    const formCreateData = await formCreateRes.json();
    if (!formCreateRes.ok) {
        logToFile("❌ Meta Lead Form Creation Failed:", formCreateData);
        return NextResponse.json({ error: formCreateData.error?.message || "Failed to create Meta Lead Form" }, { status: 400 });
    }
    return NextResponse.json({ success: true, id: formCreateData.id });
  } catch (error: any) {
    console.error("Create Form Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}