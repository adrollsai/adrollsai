import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createKieImageTask } from '@/utils/external-apis';

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { prompts } = await request.json();
        
        if (!prompts || !Array.isArray(prompts) || prompts.length === 0) {
            return NextResponse.json({ error: 'Missing prompts array' }, { status: 400 });
        }

        const taskIds = [];
        
        // Fire off all tasks simultaneously
        const promises = prompts.map(prompt => createKieImageTask(prompt));
        const results = await Promise.all(promises);
        
        for (const taskId of results) {
            if (taskId) {
                taskIds.push(taskId);
            }
        }

        return NextResponse.json({ success: true, taskIds });
    } catch (error: any) {
        console.error("Variation Generation Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
