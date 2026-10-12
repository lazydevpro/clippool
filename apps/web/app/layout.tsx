import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { APP_URL } from "@/lib/client/env";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "Brands lock a USDC pool, creators post YouTube Shorts, and the pool is split by views and paid instantly on Arc. Transparent, capped, verifiable.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "ClipPool: get paid for every view, fairly", template: "%s · ClipPool" },
  description,
  applicationName: "ClipPool",
  keywords: ["Arc", "USDC", "EURC", "creator campaigns", "YouTube Shorts", "clipping", "pro-rata payouts"],
  openGraph: {
    type: "website",
    siteName: "ClipPool",
    title: "ClipPool: get paid for every view, fairly",
    description,
  },
  twitter: { card: "summary_large_image", title: "ClipPool", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d1b2f" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
