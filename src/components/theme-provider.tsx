"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { usePathname } from "next/navigation";
import { THEME } from "@/lib/brand";

// Every page is locked to the light "club" theme. A venue that sets NEXT_PUBLIC_THEME=night keeps the dark
// navy-and-lime look on the customer side; /admin stays light. No user-facing toggle.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = usePathname().startsWith("/admin");
  return (
    <NextThemesProvider
      attribute="class"
      themes={["light", "crosshair"]}
      forcedTheme={THEME === "night" && !isAdmin ? "crosshair" : "light"}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
