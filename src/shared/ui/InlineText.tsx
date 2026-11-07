/**
 * Shows model-written text. Models often wrap code in backticks, like `LEFT JOIN`: those
 * parts become <code>, and a stray backtick with no partner is dropped.
 */
export function InlineText({ text }: { text: string }) {
  // split with a capture group puts the code parts at the odd indexes.
  const parts = text.split(/`([^`\n]+)`/g);

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.9em] text-ink">
            {part}
          </code>
        ) : (
          part.replace(/`/g, "")
        ),
      )}
    </>
  );
}
