// The command palette context shared by Command and its parts, kept apart from index.ts so the SFCs and the index do not form a cycle.
import type { Ref } from "vue";
import { createContext } from "reka-ui";

export const [useCommand, provideCommandContext] = createContext<{
  allItems: Ref<Map<string, string>>;
  allGroups: Ref<Map<string, Set<string>>>;
  filterState: {
    search: string;
    filtered: { count: number; items: Map<string, number>; groups: Set<string> };
  };
}>("Command");

export const [useCommandGroup, provideCommandGroupContext] = createContext<{
  id?: string;
}>("CommandGroup");
