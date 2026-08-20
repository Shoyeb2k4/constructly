import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { isDemoMode } from "@/lib/env";
import { HIDDEN_TAB_RAF_SCRIPT } from "@/lib/dev/hidden-tab-raf";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Constructly — Construction ERP",
    template: "%s · Constructly",
  },
  description:
    "The modern construction ERP. Manage projects, labor, procurement, and vendors from one beautiful place.",
  applicationName: "Constructly",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        {/* DEMO ONLY, and deliberately not a component: it must execute while
            the document is still parsing, before React streams its first
            boundary-completion script. See hidden-tab-raf.ts for the failure
            this prevents. */}
        {isDemoMode && (
          <script dangerouslySetInnerHTML={{ __html: HIDDEN_TAB_RAF_SCRIPT }} />
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
