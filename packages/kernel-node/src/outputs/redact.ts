// Redaction: the exact non-public .env values of at least 8 characters, longest first, and the
// Stripe token prefixes; every match becomes ***, repeated until nothing matches.
import { inspect } from "node:util";

export type Redact = (text: string) => string;

/** Shorter values (`3000`, `debug`) would mask ordinary output; GitLab masks variables from 8 characters too. */
export const minSecretLength = 8;

const tokens = String.raw`\b(?:sk_live_|sk_test_|rk_|whsec_)\w*`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Captured when the module loads: a cell that replaces JSON.stringify cannot unmask a secret. */
const stringify = JSON.stringify.bind(JSON);

/** A secret as it appears in outputs: as is, escaped inside JSON text, escaped inside util.inspect text. */
const variants = (secret: string): readonly string[] => [
  secret,
  stringify(secret).slice(1, -1),
  inspect(secret).slice(1, -1),
];

/**
 * A redactor over `secrets` plus the token prefixes. Secrets come first in the alternation, so a secret that
 * starts like a token is masked whole; replacing until nothing matches means no secret survives a join.
 */
export function createRedactor(secrets: Iterable<string>): Redact {
  const long = [...secrets].filter((secret) => secret.length >= minSecretLength);
  const literals = [...new Set(long.flatMap(variants))].sort((a, b) => b.length - a.length);
  const pattern = new RegExp([...literals.map(escapeRegExp), tokens].join("|"), "g");
  return (text) => {
    let current = text;
    for (;;) {
      const next = current.replace(pattern, "***");
      if (next === current) return current;
      current = next;
    }
  };
}
