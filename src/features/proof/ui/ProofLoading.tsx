import { Spinner } from "@/shared/ui";
import { ProofFrame } from "./ProofFrame";

export function ProofLoading() {
  return (
    <ProofFrame>
      <p role="status" className="flex items-center gap-3 py-8 text-ink-soft">
        <Spinner size={18} />
        Loading this evidence record
      </p>
    </ProofFrame>
  );
}
