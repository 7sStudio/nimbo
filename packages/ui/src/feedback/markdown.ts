// Feedback entries in words, for the list's rows and for Copy as Markdown, which a user pastes into an agent's chat:
// each note with where it points and the absolute paths of its screenshots.
import type { FeedbackEntry } from "../store/feedbackApi.js";

/** `demo.jsnb · Cell 3 · CellCard › CellHeader button`, or `Home · HomeRow li`. */
export function whereOf(entry: FeedbackEntry): string {
  const page = entry.page.kind === "home" ? "Home" : entry.page.notebook || entry.page.path;
  const cell = entry.page.cell === undefined ? [] : [`Cell ${String(entry.page.cell.index + 1)}`];
  const names = entry.components.slice(-3).join(" › ");
  const element = entry.area === undefined ? entry.element.tag : "area";
  return [page, ...cell, `${names} ${element}`.trim()].join(" · ");
}

export function markdownOf(entries: readonly FeedbackEntry[], dir: string): string {
  const items = entries.map((entry, at) => {
    const shots = Object.values(entry.shots).map((name) => `${dir}/${name}`);
    return [
      `${String(at + 1)}. ${entry.text.replace(/\n/gu, "\n   ")}`,
      `   - Where: ${whereOf(entry)}`,
      `   - Selector: \`${entry.selector}\``,
      ...(shots.length === 0 ? [] : [`   - Screenshots: ${shots.join(", ")}`]),
      `   - Entry: ${entry.id} (${entry.status})`,
    ].join("\n");
  });
  return [`UI feedback from the app, in ${dir}/feedback.jsonl:`, "", ...items, ""].join("\n");
}
