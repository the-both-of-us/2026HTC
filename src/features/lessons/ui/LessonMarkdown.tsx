import { Lightbulb } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The small slice of Markdown a lesson uses, rendered without a parser library or raw HTML:
 * **key terms**, *emphasis*, `code`, "- " and "1. " lists, and one "> Tip:" callout.
 * Anything else shows as plain text, so older lessons with no Markdown read exactly as before.
 */

// Code, bold, then italic. Bold must come before italic so "**x**" is not read as two "*".
const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*)/g;

/** One line of text with inline marks. */
export function MdInline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return part.replace(/`/g, "");
        if (part.startsWith("`")) {
          return (
            <code key={index} className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.9em] text-read-code">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith("**") || part.startsWith("__")) {
          // A key term: bold, with a marker stroke under its lower half.
          return (
            <strong key={index} className="md-key font-semibold text-read-key">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <em key={index}>{part.slice(1, -1)}</em>;
      })}
    </>
  );
}

type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] } | { kind: "tip"; text: string };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const QUOTE = /^\s*>\s?/;

/** Splits a model-written string into paragraphs, lists and tips. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const last = blocks.at(-1);
    if (BULLET.test(line) || NUMBER.test(line)) {
      const kind = BULLET.test(line) ? "ul" : "ol";
      const item = line.replace(kind === "ul" ? BULLET : NUMBER, "");
      if (last?.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (QUOTE.test(line)) {
      const tip = line.replace(QUOTE, "").replace(/^\*{0,2}tip:?\*{0,2}:?\s*/i, "");
      if (last?.kind === "tip") last.text += ` ${tip}`;
      else blocks.push({ kind: "tip", text: tip });
    } else {
      blocks.push({ kind: "p", text: line.replace(/^#{1,6}\s+/, "") });
    }
  }
  return blocks;
}

/** A model-written string as paragraphs, lists and tip callouts. */
export function MdBlocks({ text, paragraphClassName }: { text: string; paragraphClassName?: string }) {
  return (
    <>
      {parseBlocks(text).map((block, index): ReactNode => {
        if (block.kind === "p") {
          return (
            <p key={index} className={paragraphClassName}>
              <MdInline text={block.text} />
            </p>
          );
        }
        if (block.kind === "tip") {
          return (
            <aside
              key={index}
              className="flex gap-3 rounded-control border-l-4 border-read-tip bg-read-tip-surface px-4 py-3"
            >
              <Lightbulb aria-hidden="true" size={18} className="mt-1 shrink-0 text-read-tip" />
              <p>
                <span className="font-semibold text-read-tip">Tip: </span>
                <MdInline text={block.text} />
              </p>
            </aside>
          );
        }
        const List = block.kind === "ul" ? "ul" : "ol";
        return (
          <List
            key={index}
            className={
              block.kind === "ul"
                ? "flex list-disc flex-col gap-1.5 pl-6 marker:text-read-key"
                : "flex list-decimal flex-col gap-1.5 pl-6 marker:font-semibold marker:text-read-key"
            }
          >
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="pl-1">
                <MdInline text={item} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

/** Plain words for Read aloud: marks and list bullets dropped. */
export function plainText(text: string): string {
  return parseBlocks(text)
    .map((block) => ("items" in block ? block.items.join(". ") : block.text))
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)\*(\S)/g, "$1$2")
    .replace(/(\S)\*(?=\s|$|[.,;:!?])/g, "$1");
}

// Keywords across the languages lessons use: SQL (any case), Python, JavaScript and TypeScript, shell.
const KEYWORDS = new Set(
  (
    "select from where join left right inner outer full on group by order having limit offset insert into values update set delete create table alter drop index primary key foreign references not null and or as in is like between distinct union all case when then else end with exists default unique " +
    "def return if elif for while import class try except finally raise lambda yield pass break continue none true false self async await " +
    "const let var function new this typeof interface type export extends implements throw catch switch null undefined of static public private " +
    "echo cd sudo git npm curl fi do done"
  ).split(" "),
);

const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;

/** Code with comments, strings, numbers, keywords and function names coloured. */
export function HighlightedCode({ code }: { code: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [whole, comment, string, number, call, word] = match;
    const start = match.index;
    if (start > last) out.push(code.slice(last, start));
    last = start + whole.length;
    // "#" starts a comment in Python and shell, but CSS colours and C includes are rare here.
    const className = comment
      ? "text-code-comment italic"
      : string
        ? "text-code-string"
        : number
          ? "text-code-number"
          : call
            ? KEYWORDS.has(call.toLowerCase())
              ? "text-code-keyword font-semibold"
              : "text-code-call"
            : word && KEYWORDS.has(word.toLowerCase())
              ? "text-code-keyword font-semibold"
              : null;
    out.push(
      className ? (
        <span key={start} className={className}>
          {whole}
        </span>
      ) : (
        whole
      ),
    );
  }
  if (last < code.length) out.push(code.slice(last));
  return <code>{out}</code>;
}

/** Strips a Markdown fence a model sometimes wraps the code field in. */
export function unfence(code: string): string {
  return code.replace(/^\s*```[\w-]*\s*\n/, "").replace(/\n?\s*```\s*$/, "");
}
