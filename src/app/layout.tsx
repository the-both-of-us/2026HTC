import type { Metadata, Viewport } from "next";
import { Cormorant, Outfit } from "next/font/google";
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
    <html lang="en-CA" className={`${outfit.variable} ${cormorant.variable}`}>
      <body>{children}</body>
    </html>
  );
}
