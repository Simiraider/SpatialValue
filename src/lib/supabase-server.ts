import { createClient } from '@supabase/supabase-js';

const clean = (v: string) => v.replace(/^["']|["']$/g, '');

const supabaseUrl = clean(process.env.SUPABASE_MAILER_URL || '');
const supabaseServiceKey = clean(process.env.SUPABASE_MAILER_SERVICE_KEY || '');

export function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
