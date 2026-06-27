import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Not logged in' });
        }

        const url = new URL(request.url);
        const impersonateId = url.searchParams.get('impersonate');

        const { data: currentProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        
        let subAccount = null;
        let isParent = false;
        let authorized = false;

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(currentProfile?.role || '')) {
                if (currentProfile?.role !== 'super_admin') {
                    isParent = (currentProfile?.agency_id === impersonateId || currentProfile?.parent_id === impersonateId);
                    const { data: sub } = await supabase
                      .from('profiles')
                      .select('id, email, role, agency_id, parent_id')
                      .eq('id', impersonateId)
                      .eq('agency_id', currentProfile?.agency_id || user.id)
                      .single();
                    subAccount = sub;
                    authorized = !!(isParent || subAccount);
                } else {
                    authorized = true;
                }
            }
        }

        return NextResponse.json({
            loggedInUser: {
                id: user.id,
                email: user.email,
                role: currentProfile?.role,
                agency_id: currentProfile?.agency_id,
                parent_id: currentProfile?.parent_id
            },
            impersonateId,
            impersonateDetails: {
                isParent,
                subAccountFound: subAccount,
                authorized
            }
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
