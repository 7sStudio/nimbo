// The workspace secrets of 03-api §4.7 and 07-file-format §8: names from `.env` (never values, never process.env),
// one key set at a time, and the client's public env that goes with every realm.execute (04-kernel §8).
import { isPublicEnvName, parseDotenv } from "@jsnb/kernel-node";

import { envNames, readEnvText, setEnvValue } from "../../files/secrets/dotenv.js";

export type SecretsService = {
  readonly list: () => Promise<readonly string[]>;
  readonly set: (name: string, value: string) => Promise<void>;
  /** `PUBLIC_*` and `*_PUBLISHABLE_KEY` with their values, re-read per call, never one that looks like a secret. */
  readonly publicEnv: () => Promise<Readonly<Record<string, string>>>;
};

/** The token prefixes of 04-kernel §10: a value that holds one never reaches the page, whatever its name. */
const secretToken = /\b(?:sk_live_|sk_test_|rk_|whsec_)\w/;

/** The secrets of the `.env` at `path`; `onWrite` hears every write (the daemon's redactor reads it again). */
export function createSecrets(path: string, onWrite: () => void): SecretsService {
  return {
    list: () => envNames(path),
    set: async (name, value) => {
      await setEnvValue(path, name, value);
      onWrite();
    },
    publicEnv: async () => {
      const values = parseDotenv(await readEnvText(path));
      return Object.fromEntries(
        Object.entries(values).filter(
          ([name, value]) => isPublicEnvName(name) && !secretToken.test(value),
        ),
      );
    },
  };
}
