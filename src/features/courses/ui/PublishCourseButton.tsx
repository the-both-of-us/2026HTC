import { Button } from "@/shared/ui";

export type PublishCourseButtonProps = {
  mapId: string;
};

/** Publishes a map to the public directory. Placeholder until built. */
export function PublishCourseButton({ mapId }: PublishCourseButtonProps) {
  return (
    <Button variant="subtle" size="sm" disabled data-map-id={mapId}>
      Publish course
    </Button>
  );
}
