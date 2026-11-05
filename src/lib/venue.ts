/** Public venue contact details (confirmed by the client), shown on the site and in help text. */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VenueContact {
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
}

/** Shown until the saved details load, or if they can't be read (edited in Settings, booking_settings.venue_*) */
export const VENUE_CONTACT: VenueContact = {
  phone: "+63 917 123 4567",
  phoneHref: "tel:+639171234567",
  email: "play@crosshairdinkers.com",
  address: "J.C. Aquino Ave, Butuan City",
};

/** "tel:" link for a phone written any way staff type it: +63 917 123 4567, (0917) 123-4567 */
export const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** The venue's contact details from Settings (public read); the built-in ones if they can't be read. */
export const fetchVenueContact = async (client: SupabaseClient): Promise<VenueContact> => {
  const { data, error } = await client.from("booking_settings").select("venue_phone, venue_email, venue_address").maybeSingle();
  if (error || !data) {
    if (error) console.error("Failed to load venue contact, using defaults:", error);
    return VENUE_CONTACT;
  }
  return { phone: data.venue_phone, phoneHref: phoneHref(data.venue_phone), email: data.venue_email, address: data.venue_address };
};
