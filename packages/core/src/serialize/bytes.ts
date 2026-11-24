// Base64 over a lookup table and the typed-array views the serializer treats as bytes; no Buffer, runs anywhere.

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const reverse = new Map<string, number>(Array.from(alphabet, (char, index) => [char, index]));

/** Standard base64 with padding. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet.charAt((triple >> 18) & 63) + alphabet.charAt((triple >> 12) & 63);
    out += b === undefined ? "=" : alphabet.charAt((triple >> 6) & 63);
    out += c === undefined ? "=" : alphabet.charAt(triple & 63);
  }
  return out;
}

/** Decodes standard base64; characters outside the alphabet (and padding) are ignored. */
export function fromBase64(text: string): Uint8Array {
  const digits: number[] = [];
  for (const char of text) {
    const digit = reverse.get(char);
    if (digit !== undefined) digits.push(digit);
  }
  const out = new Uint8Array(Math.floor((digits.length * 6) / 8));
  let bits = 0;
  let acc = 0;
  let index = 0;
  for (const digit of digits) {
    acc = (acc << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (acc >> bits) & 255;
      index += 1;
    }
  }
  return out;
}

/** A Uint8Array over the same memory as a typed array, DataView or ArrayBuffer; undefined for anything else. */
export function bytesOf(value: object): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}
