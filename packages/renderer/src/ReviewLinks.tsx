import { Button } from "./Form";

/** The row action that opens the review at a Question (#493). */
export function ReviewLinks({
  question,
  onClick,
}: {
  question: string;
  onClick: () => void;
}) {
  return (
    <Button aria-label={`review links for ${question}`} onClick={onClick}>
      review links
    </Button>
  );
}
