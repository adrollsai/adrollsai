import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const BIOQUE_USER_ID = '68b55a31-a16d-454d-a20f-11adabf590b0';

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface BioqueProperty {
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
  region?: 'New Chandigarh' | 'Tri-City' | 'Dubai';
  show_on_landing_page?: boolean;
  created_at?: string;
}

export function detectRegion(title: string = '', address: string = '', price: string = ''): 'New Chandigarh' | 'Tri-City' | 'Dubai' {
  const combined = `${title} ${address}`.toLowerCase();
  if (combined.includes('dubai') || price.includes('AED')) {
    return 'Dubai';
  }
  if (
    combined.includes('homeland') ||
    combined.includes('jubilee') ||
    combined.includes('motiaz') ||
    combined.includes('gmi infra') ||
    combined.includes('aventus') ||
    combined.includes('mohali') ||
    combined.includes('zirakpur') ||
    combined.includes('panchkula') ||
    (combined.includes('chandigarh') && !combined.includes('new chandigarh'))
  ) {
    return 'Tri-City';
  }
  return 'New Chandigarh';
}

export async function getBioqueProperties(): Promise<BioqueProperty[]> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', BIOQUE_USER_ID)
      .neq('status', 'Archived')
      .neq('status', 'Sold')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching Bioque properties:', error);
      return [];
    }

    return (data || []).map(p => ({
      ...p,
      region: detectRegion(p.title, p.address, p.price)
    }));
  } catch (err) {
    console.error('Supabase query exception:', err);
    return [];
  }
}

export async function getBioquePropertyById(id: string): Promise<BioqueProperty | null> {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', BIOQUE_USER_ID)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching Bioque property by ID:', error);
      return null;
    }
    if (!data) return null;
    return {
      ...data,
      region: detectRegion(data.title, data.address, data.price)
    };
  } catch (err) {
    console.error('Supabase query exception:', err);
    return null;
  }
}
