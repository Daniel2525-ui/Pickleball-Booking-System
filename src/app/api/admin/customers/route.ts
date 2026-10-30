import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const searchParams = request.nextUrl.searchParams;
        const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "100", 10)), 500);
        const search = searchParams.get("search")?.replace(/[(),%]/g, " ").trim() || "";

        let profilesQuery = supabase
            .from("profiles")
            .select("id, full_name, email, phone, created_at")
            .order("created_at", { ascending: false })
            .limit(limit);

        let customersQuery = supabase
            .from("customers")
            .select("id, full_name, email, phone, created_at")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (search) {
            profilesQuery = profilesQuery.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
            customersQuery = customersQuery.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const [profilesRes, customersRes] = await Promise.all([
            profilesQuery,
            customersQuery,
        ]);

        if (profilesRes.error) {
            console.error("Failed to load profiles:", profilesRes.error);
            return NextResponse.json({ error: profilesRes.error.message }, { status: 500 });
        }
        if (customersRes.error) {
            console.error("Failed to load customers:", customersRes.error);
            return NextResponse.json({ error: customersRes.error.message }, { status: 500 });
        }

        const combined = [
            ...(profilesRes.data || []).map((p) => ({ ...p, type: "registered" as const })),
            ...(customersRes.data || []).map((c) => ({ ...c, type: "walk_in" as const })),
        ].sort((a, b) => {
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
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

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
