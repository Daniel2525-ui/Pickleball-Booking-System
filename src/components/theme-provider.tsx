"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { usePathname } from "next/navigation";

// Every page is locked: customer side to "crosshair" (navy + lime), /admin to dark. No user-facing toggle.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = usePathname().startsWith("/admin");
  return (
    <NextThemesProvider
      attribute="class"
      themes={["dark", "crosshair"]}
      forcedTheme={isAdmin ? "dark" : "crosshair"}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
