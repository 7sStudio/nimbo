// The Explorer tree of the workspace's notebooks, as a file tree shows it: each folder a node holding
// its subfolders, then its notebooks, both in the collator's order; a folder's key ends in "/", a notebook's is its ref.
// Pure: Home's tree and the notebook page's Workspace section read it alike.
const collator = new Intl.Collator(undefined, { numeric: true });

export type TreeNode = {
  /** "api/stripe/" for a folder, "api/stripe/checkout.jsnb" for a notebook. */
  readonly key: string;
  readonly name: string;
  /** The folder's ref without the slash, or the notebook's ref. */
  readonly path: string;
  readonly folder: boolean;
  readonly children?: readonly TreeNode[];
};

/** A folder's tree key. */
const folderKey = (folder: string): string => `${folder}/`;

/** The keys of every folder above `path`, outermost first. */
export function folderKeysOf(path: string): readonly string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, at) => folderKey(parts.slice(0, at + 1).join("/")));
}

type Draft = { folders: Map<string, Draft>; files: string[] };

/** The tree of `paths` (notebook refs, "/"-separated). */
export function treeOf(paths: readonly string[]): readonly TreeNode[] {
  const root: Draft = { folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let at = root;
    for (const part of parts.slice(0, -1)) {
      const next = at.folders.get(part) ?? { folders: new Map(), files: [] };
      at.folders.set(part, next);
      at = next;
    }
    at.files.push(path);
  }
  const nodes = (draft: Draft, prefix: string): readonly TreeNode[] => [
    ...[...draft.folders]
      .sort(([a], [b]) => collator.compare(a, b))
      .map(([name, inner]): TreeNode => {
        const path = `${prefix}${name}`;
        return {
          key: folderKey(path),
          name,
          path,
          folder: true,
          children: nodes(inner, `${path}/`),
        };
      }),
    ...[...draft.files]
      .sort((a, b) => collator.compare(a, b))
      .map((path): TreeNode => ({
        key: path,
        name: path.slice(prefix.length),
        path,
        folder: false,
      })),
  ];
  return nodes(root, "");
}
