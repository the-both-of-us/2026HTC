import { ProofNotFound } from "@/features/proof";

/**
 * The app's 404, sent with a real 404 status. Most people who reach it followed a shared
 * evidence link (src/proxy.ts sends a missing or withdrawn one here), so it speaks to them.
 */
export default function NotFound() {
  return <ProofNotFound title="We could not find this page" />;
}
