-- Migration: Add last_ai_analysis column to profiles to cache revenue/business AI recommendations
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_ai_analysis JSONB DEFAULT NULL;
