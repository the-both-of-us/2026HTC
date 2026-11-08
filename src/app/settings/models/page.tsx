import type { Metadata } from "next";
import { benchResults, BenchmarksScreen } from "@/features/benchmarks";

export const metadata: Metadata = {
  title: "Model comparisons",
  description: "How gpt-oss-120b, Claude Haiku, Sonnet and Opus score on public exam questions by subject, and how fast each writes a lesson.",
};

export default function ModelComparisonsPage() {
  return <BenchmarksScreen results={benchResults} />;
}
