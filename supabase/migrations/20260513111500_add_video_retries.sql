-- Add retry tracking to video_tasks
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS last_successful_task_id TEXT;
ALTER TABLE public.video_tasks ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE;
