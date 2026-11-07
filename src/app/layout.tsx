import type { Metadata, Viewport } from "next";
import { Cormorant, Lexend, Outfit } from "next/font/google";
import { LEARNING_MODE_SCRIPT } from "@/shared/ui/learningMode";
import "./globals.css";

// No `weight` option: it loads as a variable font. Static weights of some Google
// fonts fail on Vercel's builders even though local builds pass.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const cormorant = Cormorant({
  variable: "--font-cormorant",
  subsets: ["latin"],
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
  themeColor: "#070a10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script below may add data-learning-mode before React loads, hence suppressHydrationWarning.
    <html lang="en-CA" className={`${outfit.variable} ${cormorant.variable} ${lexend.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LEARNING_MODE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
