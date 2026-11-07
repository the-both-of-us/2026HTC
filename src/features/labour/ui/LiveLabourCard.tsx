import { getLabourSnapshot } from "../service";
import { LabourCard } from "./LabourCard";

/** Server component that fetches itself. Wrap in <Suspense> where used. */
export async function LiveLabourCard() {
  return <LabourCard snapshot={await getLabourSnapshot()} />;
}
