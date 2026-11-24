// The browser as Home's commands use it: its query (the token a notebook's page carries too) and where
// the page is sent next (location.assign, or a test's record).
export type HomeHost = {
  readonly search: () => string;
  readonly navigate: (url: string) => void;
};
