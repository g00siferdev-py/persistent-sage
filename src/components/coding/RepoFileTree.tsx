import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";

export type RepoTreeNode = {
  name: string;
  pathRel: string;
  kind: string;
  children?: RepoTreeNode[];
};

type Props = {
  nodes: RepoTreeNode[];
  loading?: boolean;
};

function TreeNode({ node, depth }: { node: RepoTreeNode; depth: number }) {
  const isDir = node.kind === "directory";
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = isDir && (node.children?.length ?? 0) > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => isDir && setOpen((v) => !v)}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] text-slate-300 hover:bg-slate-800/80"
        style={{ paddingLeft: `${depth * 10 + 4}px` }}
        title={node.pathRel}
      >
        {isDir ? (
          hasChildren ? (
            open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
            )
          ) : (
            <span className="inline-block w-3 shrink-0" />
          )
        ) : (
          <span className="inline-block w-3 shrink-0" />
        )}
        {isDir ? (
          <Folder className="h-3 w-3 shrink-0 text-amber-500/80" aria-hidden />
        ) : (
          <File className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && open && hasChildren ? (
        <ul>
          {node.children!.map((child) => (
            <TreeNode key={child.pathRel} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RepoFileTree({ nodes, loading }: Props) {
  if (loading) {
    return <p className="px-3 py-2 text-xs text-slate-500">Loading tree…</p>;
  }
  if (nodes.length === 0) {
    return <p className="px-3 py-2 text-xs text-slate-500">No files to show.</p>;
  }
  return (
    <ul className="py-1">
      {nodes.map((node) => (
        <TreeNode key={node.pathRel} node={node} depth={0} />
      ))}
    </ul>
  );
}
