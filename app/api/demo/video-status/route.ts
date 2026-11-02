import { NextResponse } from 'next/server';
import { queryKieTask } from '@/utils/external-apis';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const taskId = searchParams.get('taskId');
        if (!taskId) {
            return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
        }
        const status = await queryKieTask(taskId);
        return NextResponse.json(status);
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Failed to query video task status' }, { status: 500 });
    }
}

