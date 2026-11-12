import { NextRequest, NextResponse } from "next/server";
import { createClient, requireOwner } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import { parseDiscountInput } from "@/lib/services/pricing/discounts";

// Owner only (proxy.ts and requireOwner). discount_codes has no write policy: writes go through the service role here.

const serviceOrError = () => {
    const admin = getServiceClient();
    return admin
        ? { admin, error: null }
        : { admin: null, error: NextResponse.json({ error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is required." }, { status: 500 }) };
};

/** Every code with how many checkouts use it, and the latest checkouts that used a code. */
export async function GET() {
    const { denied } = await requireOwner();
    if (denied) return denied;
    const { admin, error } = serviceOrError();
    if (!admin) return error;

    const [{ data: codes, error: codesError }, { data: uses, error: usesError }] = await Promise.all([
        admin.from("discount_codes").select("id, code, kind, value, active, starts_on, ends_on, max_uses, created_at").order("created_at", { ascending: false }),
        admin
            .from("bookings")
            .select("id, basket_id, discount_code_id, discount_amount, status, booking_date, created_at, customer_name, profiles:user_id(full_name, is_guest)")
            .not("discount_code_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(300),
    ]);
    if (codesError || usesError) {
        console.error("Failed to load discount codes:", codesError || usesError);
        return NextResponse.json({ error: "Could not load discount codes." }, { status: 500 });
    }
    const counts = await Promise.all(
        (codes ?? []).map((c) => admin.rpc("discount_code_uses", { p_code_id: c.id }).then(({ data }) => Number(data ?? 0)))
    );
    return NextResponse.json({
        codes: (codes ?? []).map((c, i) => ({ ...c, value: Number(c.value), uses: counts[i] })),
        uses: uses ?? [],
    });
}

/** A new code. */
export async function POST(request: NextRequest) {
    const { denied } = await requireOwner();
    if (denied) return denied;
    const parsed = parseDiscountInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { admin, error } = serviceOrError();
    if (!admin) return error;
    const { data: { user } } = await (await createClient()).auth.getUser();

    const { data, error: insertError } = await admin
        .from("discount_codes")
        .insert({ ...parsed.value, created_by: user?.id ?? null })
        .select("id")
        .single();
    if (insertError) {
        if (insertError.code === "23505") return NextResponse.json({ error: `There is already a code ${parsed.value.code}.` }, { status: 409 });
        console.error("Failed to create discount code:", insertError);
        return NextResponse.json({ error: "Could not save the code." }, { status: 500 });
    }
    return NextResponse.json({ data });
}

/** Edit a code. Once a checkout has used it, only its dates, limit and on/off can change. On/off changes only when sent. */
export async function PATCH(request: NextRequest) {
    const { denied } = await requireOwner();
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "Missing code." }, { status: 400 });
    if (body?.active !== undefined && typeof body.active !== "boolean") return NextResponse.json({ error: "On/off must be true or false." }, { status: 400 });
    const parsed = parseDiscountInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { admin, error } = serviceOrError();
    if (!admin) return error;

    const { data: current } = await admin.from("discount_codes").select("code, kind, value").eq("id", id).maybeSingle();
    if (!current) return NextResponse.json({ error: "That code no longer exists." }, { status: 404 });
    const { data: uses } = await admin.rpc("discount_code_uses", { p_code_id: id });
    // Bookings that used the code also point at it, so a used code is never deleted or rewritten
    const { count: everUsed } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("discount_code_id", id);
    const rewritten = current.code !== parsed.value.code || current.kind !== parsed.value.kind || Number(current.value) !== parsed.value.value;
    if (rewritten && (Number(uses) > 0 || (everUsed ?? 0) > 0)) {
        return NextResponse.json({ error: "This code has been used: only its dates, limit and on/off can change." }, { status: 400 });
    }

    const { error: updateError } = await admin
        .from("discount_codes")
        .update({ ...parsed.value, ...(typeof body.active === "boolean" ? { active: body.active } : {}) })
        .eq("id", id);
    if (updateError) {
        if (updateError.code === "23505") return NextResponse.json({ error: `There is already a code ${parsed.value.code}.` }, { status: 409 });
        console.error("Failed to update discount code:", updateError);
        return NextResponse.json({ error: "Could not save the code." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
}
