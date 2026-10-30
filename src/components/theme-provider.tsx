"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { usePathname } from "next/navigation";

// Everything outside /admin is locked to the "crosshair" (navy + lime) theme; admin keeps its light/dark toggle (dark by default).
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const isAdmin = usePathname().startsWith("/admin");
  return (
    <NextThemesProvider
      attribute="class"
      themes={["light", "dark", "crosshair"]}
      forcedTheme={isAdmin ? undefined : "crosshair"}
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
