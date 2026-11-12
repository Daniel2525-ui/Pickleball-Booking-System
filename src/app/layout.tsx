import type { Metadata, Viewport } from "next"
import { Inter, Space_Grotesk } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"
import { BRAND_COLOR, SITE_URL, VENUE_NAME, onBrandColor } from "@/lib/brand";

// Inter for text, Space Grotesk for headings (globals.css)
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk" })

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#ffffff" },
  ],
}

export const metadata: Metadata = {
  title: { default: VENUE_NAME, template: `%s | ${VENUE_NAME}` },
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  description: "Dink with precision. Book your court. Play your game.",
  // The preview image itself is src/app/opengraph-image.tsx
  openGraph: { siteName: VENUE_NAME, type: "website" },
  twitter: { card: "summary_large_image" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      style={{ "--brand": BRAND_COLOR, "--on-brand": onBrandColor(BRAND_COLOR) } as React.CSSProperties}
    >
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans antialiased selection:bg-primary/20 selection:text-primary`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}