import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const searchParams = request.nextUrl.searchParams;
        const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "100", 10)), 500);

        const [profilesRes, customersRes] = await Promise.all([
            supabase
                .from("profiles")
                .select("id, full_name, email, phone, created_at")
                .order("created_at", { ascending: false })
                .limit(limit),
            supabase
                .from("customers")
                .select("id, full_name, email, phone, created_at")
                .order("created_at", { ascending: false })
                .limit(limit),
        ]);

        if (profilesRes.error) {
            console.error("Failed to load profiles:", profilesRes.error);
            return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
        }
        if (customersRes.error) {
            console.error("Failed to load customers:", customersRes.error);
            return NextResponse.json({ error: customersRes.error.message }, { status: 500 });
        }

        const combined = [...(profilesRes.data || []), ...(customersRes.data || [])].sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        });

        return NextResponse.json({ data: combined });
    } catch (error) {
        console.error("Fetch customers route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const body = await request.json().catch(() => null);
        const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
        const phone = typeof body?.phone === "string" ? body.phone.trim() || null : null;
        const email = typeof body?.email === "string" ? body.email.trim() || null : null;

        if (!fullName) {
            return NextResponse.json({ error: "Full name is required for walk-in customer." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("customers")
            .insert({
                full_name: fullName,
                phone,
                email,
            })
            .select()
            .single();

        if (error) {
            console.error("Failed to insert customer:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Create customer route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
