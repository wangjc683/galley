import { Fragment, useMemo, useRef, useState } from "react";
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
  // Mirrors `current` for the "2 / 7" readout; -1 = not navigated yet.
  const [position, setPosition] = useState(-1);
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
    setPosition(current.current);
  };
  if (!parsed?.length)
    return (
      <p role="alert" className="p-4 text-sm text-ink-soft">
        {copy.renderFailed}
      </p>
    );
  const hunkCount = parsed.reduce((sum, file) => sum + file.hunks.length, 0);
  return (
    <div ref={container} className="git-review-diff min-w-0 text-[12px]">
      {hunkCount > 0 ? (
        <div
          title={copy.contextHint}
          className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-app px-3 py-1 text-ui-tertiary text-ink-muted"
        >
          <span className="tabular-nums">
            {copy.changePosition(position < 0 ? 0 : position + 1, hunkCount)}
          </span>
          <div className="flex">
            <IconButton
              ariaLabel={copy.previous}
              size="xs"
              onClick={() => navigate(-1)}
            >
              <CaretUp size={13} weight="bold" />
            </IconButton>
            <IconButton
              ariaLabel={copy.next}
              size="xs"
              onClick={() => navigate(1)}
            >
              <CaretDown size={13} weight="bold" />
            </IconButton>
          </div>
        </div>
      ) : (
        <p className="p-4 text-ui-secondary text-ink-soft">{copy.metadataOnly}</p>
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
                  {/* Git's `@@ -a,b +c,d @@` header is a machine locator;
                      readers want "where does this hunk start". Keep the raw
                      form reachable via title for anyone pasting line refs. */}
                  <div
                    data-git-hunk
                    title={hunk.content}
                    className="border-y border-line/70 bg-surface px-3 py-1 font-sans text-ui-tertiary text-ink-muted"
                  >
                    {copy.hunkAt(hunk.newStart)}
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
