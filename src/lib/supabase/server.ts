import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
    const cookieStore = await cookies()
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return cookieStore.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        cookieStore.set(name, value, options))
                },
            },
        }
    )
}

/**
 * The signed-in admin's client, or the 401/403 response to return. proxy.ts checks the same;
 * this still guards a route if the matcher ever misses it.
 */
export async function requireAdmin() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { supabase: null, denied: Response.json({ error: "Unauthorized." }, { status: 401 }) }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin') return { supabase: null, denied: Response.json({ error: "Admin access required." }, { status: 403 }) }

    return { supabase, denied: null }
}

/** Like requireAdmin, for the owner only (Pricing and Settings); front-desk staff get a 403. */
export async function requireOwner() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { supabase: null, denied: Response.json({ error: "Unauthorized." }, { status: 401 }) }

    const { data: profile } = await supabase.from('profiles').select('role, is_owner').eq('id', user.id).maybeSingle()
    if (profile?.role !== 'admin' || !profile.is_owner) {
        return { supabase: null, denied: Response.json({ error: "Only an admin can do this." }, { status: 403 }) }
    }

    return { supabase, denied: null }
}
