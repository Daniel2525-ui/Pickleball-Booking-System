import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client with the service role (bypasses RLS).
 * Returns null when the key or URL is not configured; each caller decides its own fallback.
 */
export function getServiceClient(): SupabaseClient | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false } });
}
