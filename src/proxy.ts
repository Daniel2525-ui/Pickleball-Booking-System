import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
    const supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return request.cookies.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()

    // Pricing and Settings are the owner's; front-desk staff (role admin, not owner) use every other admin page
    const path = request.nextUrl.pathname
    const ownerOnly = /^\/admin\/(pricing|settings|reports)(\/|$)/.test(path) || /^\/api\/admin\/pricing(\/|$)/.test(path)

    // Protect /api/admin API routes — must be logged in + admin role
    if (request.nextUrl.pathname.startsWith('/api/admin')) {
        if (!user) {
            return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_owner')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            return NextResponse.json({ error: "Admin access required." }, { status: 403 })
        }
        if (ownerOnly && !profile.is_owner) {
            return NextResponse.json({ error: "Only an admin can do this." }, { status: 403 })
        }
    }

    // Protect /admin routes — must be logged in + admin role
    if (request.nextUrl.pathname.startsWith('/admin')) {
        if (!user) {
            return NextResponse.redirect(new URL('/', request.url))
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, is_owner')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            return NextResponse.redirect(new URL('/', request.url))
        }
        if (ownerOnly && !profile.is_owner) {
            return NextResponse.redirect(new URL('/admin/dashboard', request.url))
        }
    }

    // Redirect logged-in users away from login page
    if (request.nextUrl.pathname === '/login' && user) {
        const { data: profile } = await supabase
            .from('profiles').select('role').eq('id', user.id).single()

        const destination = profile?.role === 'admin' ? '/admin/dashboard' : '/'
        return NextResponse.redirect(new URL(destination, request.url))
    }

    return supabaseResponse
}

export const config = {
    matcher: ['/admin/:path*', '/api/admin/:path*', '/login'],
}
