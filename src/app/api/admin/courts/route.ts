import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const body = await request.json().catch(() => null);
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const status = typeof body?.status === "string" ? body.status.trim() : "active";

        if (!name) {
            return NextResponse.json({ error: "Court name is required." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("courts")
            .insert([{ name, status }])
            .select()
            .single();

        if (error) {
            console.error("Failed to insert court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Court creation route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        const name = typeof body?.name === "string" ? body.name.trim() : "";
        const status = typeof body?.status === "string" ? body.status.trim() : "";

        if (!id || !name || !status) {
            return NextResponse.json({ error: "Court id, name, and status are required." }, { status: 400 });
        }

        const { data, error } = await supabase
            .from("courts")
            .update({ name, status })
            .eq("id", id)
            .select()
            .single();

        if (error) {
            console.error("Failed to update court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ data });
    } catch (error) {
        console.error("Court update route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

        const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";

        if (!id) {
            return NextResponse.json({ error: "Court id is required." }, { status: 400 });
        }

        // Prevent deleting a court with existing bookings
        const { data: existingBookings, error: checkError } = await supabase
            .from("bookings")
            .select("id")
            .eq("court_id", id)
            .limit(1);

        if (checkError) {
            console.error("Failed to check court bookings:", checkError);
            return NextResponse.json({ error: "Failed to verify court usage." }, { status: 500 });
        }

        if (existingBookings && existingBookings.length > 0) {
            return NextResponse.json(
                {
                    error: "This court cannot be deleted because it has associated booking records. Please set its status to 'Maintenance' instead.",
                },
                { status: 409 }
            );
        }

        const { error } = await supabase.from("courts").delete().eq("id", id);
        if (error) {
            console.error("Failed to delete court:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Court deletion route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
