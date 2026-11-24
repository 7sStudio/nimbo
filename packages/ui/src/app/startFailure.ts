// What a page whose start stopped tells the user (banners, §9.1.5 the output tab): the
// error's name read from the session's failure, and the words for it, the notebook named and what to do next.

export type FailureWords = { readonly title: string; readonly text: string };

/** The name of the error that stopped the page's start, or null. */
export const failureName = (failure: unknown): string | null => {
  const name: unknown =
    failure === null || failure === undefined ? undefined : Reflect.get(Object(failure), "name");
  return typeof name === "string" ? name : null;
};

/** The words for a start stopped by `failure` (an error name, or null for a socket closed without one): a title and one
 * short line; the banner's Home button is the way on, and `nimbo open` the way from a shell. */
export function failureWords(failure: string | null, notebook: string): FailureWords {
  if (failure === "Unauthorized")
    return { title: "Not authorized", text: `Token expired. Reopen with nimbo open ${notebook}.` };
  if (failure === "NotebookNotFound")
    return { title: "Notebook not open", text: `${notebook} is closed, renamed or deleted.` };
  if (failure === null)
    return {
      title: "Disconnected",
      text: `Daemon closed the connection. Reopen with nimbo open ${notebook}.`,
    };
  return { title: "Could not open the notebook", text: `Daemon refused it (${failure}).` };
}
