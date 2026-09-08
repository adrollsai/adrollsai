import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const DECCAN_USER_ID = '93c65dee-87a5-48e3-a2d2-406182a33b37';

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Property {
  id: string;
  user_id: string;
  title: string;
  address: string;
  price: string;
  description: string;
  property_type: string;
  status: string;
  image_url: string;
  images?: string[];
  configurations?: any;
  show_on_landing_page?: boolean;
  created_at?: string;
}

export async function getDeccanProperties(): Promise<Property[]> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', DECCAN_USER_ID)
      .neq('status', 'Archived')
      .neq('status', 'Sold')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching Deccan properties:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Supabase query exception:', err);
    return [];
  }
}

export async function getDeccanPropertyById(id: string): Promise<Property | null> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', DECCAN_USER_ID)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching Deccan property by ID:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Supabase query exception:', err);
    return null;
  }
}
