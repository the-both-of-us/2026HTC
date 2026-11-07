"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";

/**
 * Loads a sample when a link asks for one, as /?sample=data-analyst-grid on the grid page does.
 * Reading the query needs its own Suspense boundary, so the form itself stays in the static page.
 */
export function SampleFromLink({ onSample }: { onSample: (text: string) => void }) {
  const sampleId = useSearchParams().get("sample");

  useEffect(() => {
    const sample = SAMPLE_POSTINGS.find((item) => item.id === sampleId);
    if (sample) onSample(sample.text);
  }, [sampleId, onSample]);

  return null;
}
