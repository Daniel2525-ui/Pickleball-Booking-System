import { createClient } from "@supabase/supabase-js";

/** Anonymous server-side client for public tables (courts, hours, pricing) on statically rendered pages. */
export const getPublicClient = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
    });
