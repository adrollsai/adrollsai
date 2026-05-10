-- Create video_tasks table to track multi-segment video generations
CREATE TABLE IF NOT EXISTS public.video_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
    prompts JSONB NOT NULL, -- Array of strings (the 4 scene prompts)
    current_index INTEGER DEFAULT 0,
    last_task_id TEXT,
    final_caption TEXT,
    aspect_ratio TEXT DEFAULT '9:16',
    status TEXT DEFAULT 'Processing',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.video_tasks ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own video tasks" ON public.video_tasks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own video tasks" ON public.video_tasks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own video tasks" ON public.video_tasks
    FOR DELETE USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_video_tasks_updated_at
    BEFORE UPDATE ON public.video_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
