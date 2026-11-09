import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/server";
import { formatManilaDate } from "@/lib/utils/bookingTime";
import { formatTime12h } from "@/lib/utils/formatTime";

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Blocks one court for part of a day; refused while a booking or another block is in the way. */
export async function POST(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const str = (k: string) => (typeof body?.[k] === "string" ? body[k].trim() : "");
        const [courtId, date, start, end, reason] = ["courtId", "date", "start", "end", "reason"].map(str);

        if (!isId(courtId)) return NextResponse.json({ error: "Choose a court." }, { status: 400 });
        if (!isDate(date) || date < formatManilaDate()) return NextResponse.json({ error: "Choose today or a later date." }, { status: 400 });
        if (!isTime(start) || !isTime(end) || end <= start) return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
        if (reason.length > 120) return NextResponse.json({ error: "Keep the reason under 120 characters." }, { status: 400 });

        // The same feed the booking grids use: live bookings, unexpired holds and existing blocks
        // shortcut: check-then-insert, so a booking made in the same instant can slip in; fine for a staff action
        const { data: taken, error: takenError } = await supabase.rpc("get_public_slot_availability", { p_booking_date: date });
        if (takenError) {
            console.error("Court block conflict check failed:", takenError);
            return NextResponse.json({ error: "Could not check the court's bookings. Try again." }, { status: 500 });
        }
        const clash = ((taken ?? []) as { court_id: string; start_time: string; end_time: string; status: string }[])
            .filter((s) => s.court_id === courtId && s.start_time.slice(0, 5) < end && s.end_time.slice(0, 5) > start)
            .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
        if (clash) {
            const what = clash.status === "blocked" ? "already blocked" : "already booked";
            return NextResponse.json(
                { error: `This court is ${what} ${formatTime12h(clash.start_time)} – ${formatTime12h(clash.end_time)}. Move or cancel that first, or pick other hours.` },
                { status: 409 },
            );
        }

        const { data, error } = await supabase
            .from("court_blocks")
            .insert({ court_id: courtId, block_date: date, start_time: start, end_time: end, reason: reason || null })
            .select()
            .single();
        if (error) {
            console.error("Failed to add court block:", error);
            return NextResponse.json({ error: "Could not save the block." }, { status: 500 });
        }
        return NextResponse.json({ data });
    } catch (error) {
        console.error("Court blocks POST route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

/** Removes a block; the hours become bookable again. */
export async function DELETE(request: NextRequest) {
    try {
        const { supabase, denied } = await requireAdmin();
        if (denied) return denied;

        const body = await request.json().catch(() => null);
        const id = typeof body?.id === "string" ? body.id.trim() : "";
        if (!isId(id)) return NextResponse.json({ error: "Block not found." }, { status: 400 });

        const { error } = await supabase.from("court_blocks").delete().eq("id", id);
        if (error) {
            console.error("Failed to remove court block:", error);
            return NextResponse.json({ error: "Could not remove the block." }, { status: 500 });
        }
        return NextResponse.json({ data: { id } });
    } catch (error) {
        console.error("Court blocks DELETE route error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
