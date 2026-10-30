import type { Metadata, Viewport } from "next"
import { Big_Shoulders, Manrope, Poppins } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-poppins",
})

// Customer side (the "crosshair" theme): scoreboard headings + Manrope body, see globals.css
const bigShoulders = Big_Shoulders({ subsets: ["latin"], variable: "--font-big-shoulders" })
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" })

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d131f" },
  ],
}

export const metadata: Metadata = {
  title: "Crosshair Dinkers",
  description: "Dink with precision. Book your court. Play your game.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${poppins.variable} ${bigShoulders.variable} ${manrope.variable} font-sans antialiased selection:bg-primary/20 selection:text-primary`}>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}