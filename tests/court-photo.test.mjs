import test from "node:test";
import assert from "node:assert/strict";
import { isCourtPhotoUrl } from "../src/lib/services/courts/courtPhoto.ts";

test("isCourtPhotoUrl accepts only this project's court-photos bucket", () => {
    const base = "http://127.0.0.1:54321";
    const photo = `${base}/storage/v1/object/public/court-photos/c1-1.png`;
    assert.equal(isCourtPhotoUrl(photo, base), true);
    assert.equal(isCourtPhotoUrl(photo, `${base}/`), true);
    assert.equal(isCourtPhotoUrl("https://evil.example/x.png", base), false);
    assert.equal(isCourtPhotoUrl(`${base}/storage/v1/object/public/club-assets/qr.png`, base), false);
    assert.equal(isCourtPhotoUrl(`${base}/storage/v1/object/public/court-photos/`, base), false);
    assert.equal(isCourtPhotoUrl(`${base}/storage/v1/object/public/court-photos/../club-assets/qr.png`, base), false);
});
