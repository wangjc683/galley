import { Fragment, useMemo, useRef } from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import {
  Decoration,
  Diff,
  Hunk,
  markEdits,
  parseDiff,
  tokenize,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";

/** Git owns diff generation; this component only presents its patch. */
export function GitPatchView({
  patch,
  split,
}: {
  patch: string;
  split: boolean;
}) {
  const copy = useCopy().gitReview;
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(-1);
  const parsed = useMemo(() => {
    try {
      if (!patch.startsWith("diff --git ")) return null;
      const files = parseDiff(patch);
      return files.map((file) => ({
        ...file,
        // Bound word-level work separately from the overall patch size.
        tokens:
          patch.length < 50_000 &&
          patch.split("\n").every((line) => line.length < 2000)
            ? tokenize(file.hunks, {
                enhancers: [markEdits(file.hunks, { type: "line" })],
              })
            : undefined,
      }));
    } catch {
      return null;
    }
  }, [patch]);
  const navigate = (direction: number) => {
    const hunks =
      container.current?.querySelectorAll<HTMLElement>("[data-git-hunk]");
    if (!hunks?.length) return;
    current.current =
      current.current < 0
        ? direction > 0
          ? 0
          : hunks.length - 1
        : (current.current + direction + hunks.length) % hunks.length;
    hunks[current.current].scrollIntoView({ block: "start" });
  };
  if (!parsed?.length)
    return (
      <p role="alert" className="p-4 text-sm text-ink-soft">
        {copy.renderFailed}
      </p>
    );
  const hasHunks = parsed.some((file) => file.hunks.length > 0);
  return (
    <div ref={container} className="git-review-diff min-w-0 text-[12px]">
      {hasHunks ? (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1 text-xs text-ink-muted">
          <span>{copy.contextHint}</span>
          <div className="flex">
            <IconButton ariaLabel={copy.previous} onClick={() => navigate(-1)}>
              <CaretUp size={14} />
            </IconButton>
            <IconButton ariaLabel={copy.next} onClick={() => navigate(1)}>
              <CaretDown size={14} />
            </IconButton>
          </div>
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-soft">{copy.metadataOnly}</p>
      )}
      {parsed.map((file, index) => (
        <Diff
          key={index}
          viewType={split ? "split" : "unified"}
          diffType={file.type}
          hunks={file.hunks}
          tokens={file.tokens}
        >
          {(hunks) =>
            hunks.map((hunk) => (
              <Fragment key={hunk.content}>
                <Decoration>
                  <div
                    data-git-hunk
                    className="border-y border-line bg-surface px-3 py-2 text-ink-muted"
                  >
                    {hunk.content}
                  </div>
                </Decoration>
                <Hunk hunk={hunk} />
              </Fragment>
            ))
          }
        </Diff>
      ))}
    </div>
  );
}
