import { createClient } from '@supabase/supabase-js';

const clean = (v: string) => v.replace(/^["']|["']$/g, '');

const supabaseUrl = clean(import.meta.env.PUBLIC_SUPABASE_MAILER_URL || '');
const supabaseAnonKey = clean(import.meta.env.PUBLIC_SUPABASE_MAILER_KEY || '');

console.log('[SUPABASE] URL:', supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'VACÍA');
console.log('[SUPABASE] Key:', supabaseAnonKey ? supabaseAnonKey.substring(0, 20) + '...' : 'VACÍA');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
