import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side client with service_role (bypasses RLS)
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Storage bucket name
export const STORAGE_BUCKET = 'documents';

// Documents table name
export const DOCUMENTS_TABLE = 'documents';
