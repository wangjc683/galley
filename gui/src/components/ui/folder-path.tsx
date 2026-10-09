import { useHomeDir } from "@/hooks/useHomeDir";
import { splitDisplayPath } from "@/lib/display-path";
import { cn } from "@/lib/utils";

/**
 * A folder path that truncates from the parent, not the leaf
 * (2026-10-09): `~/Documents/genericagent-webui` squeezes to
 * `~/Docu…/genericagent-webui`, because the leaf is what identifies the
 * folder. The leaf only truncates once the parent is gone and it still
 * doesn't fit. The native tooltip carries the full original path.
 *
 * Font family / size / color come from the caller's `className` (or
 * inherit): a dialog field shows it in mono, a hint sentence in the
 * sentence's own face.
 */
export function FolderPathText({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  const homeDir = useHomeDir();
  const { parent, leaf } = splitDisplayPath(path, homeDir);
  // The separator rides with the leaf, so a truncated parent reads
  // `~/Docu…/genericagent-webui` — the ellipsis would otherwise eat the
  // slash and leave a gap that looks like a space.
  const separator = /[\\/]$/.test(parent) ? parent.slice(-1) : "";
  const parentText = separator ? parent.slice(0, -1) : parent;
  return (
    <span title={path} className={cn("flex min-w-0", className)}>
      {parentText && <span className="min-w-0 truncate">{parentText}</span>}
      {/* shrink-0 lets the parent absorb all the squeeze first;
          max-w-full caps the leaf at the container so an over-long
          leaf truncates instead of overflowing. */}
      <span className="max-w-full shrink-0 truncate">
        {separator}
        {leaf}
      </span>
    </span>
  );
}
