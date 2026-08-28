import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() { return request.cookies.getAll() },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options))
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()

    // Protect /admin routes — must be logged in + admin role
    if (request.nextUrl.pathname.startsWith('/admin')) {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            return NextResponse.redirect(new URL('/', request.url))
        }
    }

    // Redirect logged-in users away from login page
    if (request.nextUrl.pathname === '/login' && user) {
        const { data: profile } = await supabase
            .from('profiles').select('role').eq('id', user.id).single()
        const dest = profile?.role === 'admin' ? '/admin/dashboard' : '/'
        return NextResponse.redirect(new URL(dest, request.url))
    }

    return supabaseResponse
}

export const config = {
    matcher: ['/admin/:path*', '/login'],
}
