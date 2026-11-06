/** Storage bucket for court photos: public to read, only staff can write (migration 20261106045612_court_photos_details.sql). */
export const COURT_PHOTO_BUCKET = "court-photos";

/** A court photo must be a file in this project's court-photos bucket, never an outside address. */
export const isCourtPhotoUrl = (url: string, supabaseUrl: string) =>
    new RegExp(`^${supabaseUrl.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/storage/v1/object/public/${COURT_PHOTO_BUCKET}/[^/]+$`).test(url)
    && !url.includes("..");
