"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { VENUE_CONTACT, fetchVenueContact, type VenueContact } from "@/lib/venue";

/** The venue's contact details for client components: the built-in ones first, then the saved ones. */
export function useVenueContact(): VenueContact {
  const [venue, setVenue] = useState<VenueContact>(VENUE_CONTACT);
  useEffect(() => {
    let active = true;
    fetchVenueContact(createClient()).then((v) => active && setVenue(v));
    return () => {
      active = false;
    };
  }, []);
  return venue;
}
