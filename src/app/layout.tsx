import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// No `weight` option: it loads as a variable font. Static weights of some Google
// fonts fail on Vercel's builders even though local builds pass.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
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
    <html lang="en-CA" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
