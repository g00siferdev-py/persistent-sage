import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { useEffect, useState } from "react";

export type RepoTreeNode = {
  name: string;
  pathRel: string;
  kind: string;
  children?: RepoTreeNode[];
};

export type TreeExpandCommand = {
  version: number;
  open: boolean;
};

type Props = {
  nodes: RepoTreeNode[];
  loading?: boolean;
  expandCommand?: TreeExpandCommand | null;
  selectedPath?: string | null;
  onOpenFile?: (pathRel: string) => void;
};

function TreeNode({
  node,
  depth,
  expandCommand,
  selectedPath,
  onOpenFile,
}: {
  node: RepoTreeNode;
  depth: number;
  expandCommand?: TreeExpandCommand | null;
  selectedPath?: string | null;
  onOpenFile?: (pathRel: string) => void;
}) {
  const isDir = node.kind === "directory";
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = isDir && (node.children?.length ?? 0) > 0;

  useEffect(() => {
    if (expandCommand && isDir) {
      setOpen(expandCommand.open);
    }
  }, [expandCommand?.version, expandCommand?.open, isDir]);

  const isSelected = !isDir && selectedPath === node.pathRel;

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (isDir) {
            setOpen((v) => !v);
          } else {
            onOpenFile?.(node.pathRel);
          }
        }}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-800/80 ${
          isSelected ? "bg-violet-900/40 text-violet-100" : "text-slate-300"
        }`}
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
            <TreeNode
              key={child.pathRel}
              node={child}
              depth={depth + 1}
              expandCommand={expandCommand}
              selectedPath={selectedPath}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RepoFileTree({
  nodes,
  loading,
  expandCommand,
  selectedPath,
  onOpenFile,
}: Props) {
  if (loading) {
    return <p className="px-3 py-2 text-xs text-slate-500">Loading tree…</p>;
  }
  if (nodes.length === 0) {
    return <p className="px-3 py-2 text-xs text-slate-500">No files to show.</p>;
  }
  return (
    <ul className="py-1">
      {nodes.map((node) => (
        <TreeNode
          key={node.pathRel}
          node={node}
          depth={0}
          expandCommand={expandCommand}
          selectedPath={selectedPath}
          onOpenFile={onOpenFile}
        />
      ))}
    </ul>
  );
}
