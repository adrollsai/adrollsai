-- Fix 'max length is reached' errors by ensuring character limits are removed from key columns
-- Most commonly 'caption' in assets table is the culprit when storing long filenames or AI prompts

ALTER TABLE public.assets ALTER COLUMN caption TYPE TEXT;
ALTER TABLE public.assets ALTER COLUMN url TYPE TEXT;
ALTER TABLE public.assets ALTER COLUMN status TYPE TEXT;
ALTER TABLE public.assets ALTER COLUMN type TYPE TEXT;

-- Also ensure video_tasks table doesn't have sneaky limits
ALTER TABLE public.video_tasks ALTER COLUMN last_error TYPE TEXT;
ALTER TABLE public.video_tasks ALTER COLUMN status TYPE TEXT;
ALTER TABLE public.video_tasks ALTER COLUMN last_task_id TYPE TEXT;
ALTER TABLE public.video_tasks ALTER COLUMN last_successful_task_id TYPE TEXT;
