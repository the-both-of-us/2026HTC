import type { Metadata, Viewport } from "next";
import { Lexend, Mona_Sans } from "next/font/google";
import { Suspense } from "react";
import { SignInNotice } from "@/features/auth/client";
import { LEARNING_MODE_SCRIPT } from "@/shared/ui/learningMode";
import { THEME_SCRIPT } from "@/shared/ui/theme";
import "./globals.css";

// No `weight` option: it loads as a variable font. Static weights of some Google
// fonts fail on Vercel's builders even though local builds pass.
// Seal's one typeface. The width axis gives the wide headlines (font-stretch 125%) and the
// condensed microprint without a second font.
const mona = Mona_Sans({
  variable: "--font-mona",
  subsets: ["latin"],
  axes: ["wdth"],
});

// Accessible Learning Mode's font, made for easier reading. Not preloaded: most visitors
// never turn the mode on, and the browser fetches it only once the mode uses it.
const lexend = Lexend({
  variable: "--font-lexend",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "OryxLearn: learn a skill, then prove it",
    template: "%s | OryxLearn",
  },
  description:
    "Turn a job posting, a PDF or a topic into an interactive skill map. Explain each skill in your own words, answer a follow-up, and share the proof.",
};

export const viewport: Viewport = {
  // The browser bar follows the system setting; a chosen theme is set by theme.ts.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8efea" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1f1c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The scripts below may add data-learning-mode and data-theme before React loads, hence suppressHydrationWarning.
    <html lang="en-CA" className={`${mona.variable} ${lexend.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + LEARNING_MODE_SCRIPT }} />
      </head>
      <body>
        {/* It reads the URL, which a dynamic route only knows at request time. */}
        <Suspense fallback={null}>
          <SignInNotice />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
