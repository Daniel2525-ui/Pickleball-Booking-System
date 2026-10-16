import type { Metadata, Viewport } from "next"
import { Poppins } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

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
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${poppins.className} antialiased selection:bg-primary/20 selection:text-primary`}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}