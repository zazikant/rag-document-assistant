import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required env vars at startup
if (!supabaseUrl) {
  console.error('[Supabase] FATAL: NEXT_PUBLIC_SUPABASE_URL is not set');
}
if (!serviceRoleKey) {
  console.error('[Supabase] FATAL: SUPABASE_SERVICE_ROLE_KEY is not set');
}

// Server-side client with service_role (bypasses RLS)
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', serviceRoleKey || 'placeholder', {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Storage bucket name
export const STORAGE_BUCKET = 'documents';

// Documents table name
export const DOCUMENTS_TABLE = 'documents';
