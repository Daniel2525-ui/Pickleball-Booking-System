import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedCronRequest } from "../src/lib/utils/cronAuth.ts";

const SECRET = "s3cret-value-from-vault";

test("cron auth: accepts the exact bearer secret sent by Supabase Cron", () => {
    assert.equal(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET), true);
});

test("cron auth: rejects a wrong, shorter, longer, or differently formatted secret", () => {
    for (const header of [`Bearer wrong`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, SECRET, `bearer ${SECRET}`, `Bearer  ${SECRET}`]) {
        assert.equal(isAuthorizedCronRequest(header, SECRET), false, header);
    }
});

test("cron auth: rejects a missing header", () => {
    assert.equal(isAuthorizedCronRequest(null, SECRET), false);
    assert.equal(isAuthorizedCronRequest("", SECRET), false);
});

test("cron auth: fails closed when CRON_SECRET is unset, even for 'Bearer ' or 'Bearer null'", () => {
    for (const secret of [undefined, ""]) {
        for (const header of ["Bearer ", "Bearer undefined", "Bearer null", null]) {
            assert.equal(isAuthorizedCronRequest(header, secret), false, `${secret}/${header}`);
        }
    }
});
