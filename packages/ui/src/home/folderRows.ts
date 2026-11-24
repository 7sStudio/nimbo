// The words of Home's folder picker from a listing: its rows (the parent first, then each folder with
// the notebooks it holds directly) and the line that says what opening the folder listed means. Pure.
import { shortPath } from "../store/homeFolders.js";
import type { FolderListing } from "../store/homeFolders.js";

export type PickerRow = {
  readonly name: string;
  readonly path: string;
  /** "3 notebooks"; "" for none, or for a folder not counted. */
  readonly count: string;
  readonly parent: boolean;
};

const notebooks = (count: number): string =>
  count === 1 ? "1 notebook" : `${String(count)} notebooks`;

export const pickerRows = (listing: FolderListing): readonly PickerRow[] => [
  ...(listing.parent === null
    ? []
    : [{ name: "Parent folder", path: listing.parent, count: "", parent: true }]),
  ...listing.folders.map((folder) => ({
    name: folder.name,
    path: folder.path,
    count: folder.notebooks === null || folder.notebooks === 0 ? "" : notebooks(folder.notebooks),
    parent: false,
  })),
];

/** What opening the folder listed means, in a few words: the workspace open here, the workspace it belongs to, or how
 * many notebooks it holds directly. */
export function pickerNote(listing: FolderListing): string {
  if (listing.current)
    return listing.workspace === listing.path ? "Open here" : "In the workspace open here";
  if (listing.workspace !== listing.path) return `Opens ${shortPath(listing.workspace)}`;
  return listing.notebooks > 0 ? notebooks(listing.notebooks) : "No notebooks";
}
