-- Add youtube_url column to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS youtube_url TEXT DEFAULT NULL;
