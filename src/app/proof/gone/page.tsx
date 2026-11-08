import { notFound } from "next/navigation";

/**
 * src/proxy.ts sends a missing or withdrawn /proof/<id> here. It is static, so the 404 is
 * decided at build time and never after streaming starts; src/app/not-found.tsx is the page.
 */
export default function ProofGonePage() {
  notFound();
}
