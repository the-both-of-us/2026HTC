import { Seal } from "./seal";

/** OryxLearn's mark: a small guilloche seal in ink, from Seal. Decorative, so name it nearby. */
export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }} className={className ? `block shrink-0 ${className}` : "block shrink-0"}>
      <Seal fingerprint="a7c31f09e25d4b6a18f07c93d1e2b4a6" state="ink" center={24} detail="node" />
    </span>
  );
}
