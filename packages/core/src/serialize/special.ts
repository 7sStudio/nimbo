// Classifies a runtime value into the kinds the serializer handles, and names the class of an instance.
import { bytesOf } from "./bytes.js";

export type Kind =
  | "primitive"
  | "undefined"
  | "specialNumber"
  | "bigint"
  | "symbol"
  | "function"
  | "date"
  | "regexp"
  | "error"
  | "bytes"
  | "array"
  | "map"
  | "set"
  | "plain"
  | "instance";

const isSpecialNumber = (value: number): boolean => !Number.isFinite(value) || Object.is(value, -0);

const objectKind = (value: object): Kind => {
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof RegExp) return "regexp";
  if (value instanceof Map) return "map";
  if (value instanceof Set) return "set";
  if (value instanceof Error) return "error";
  if (bytesOf(value) !== undefined) return "bytes";
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? "plain" : "instance";
};

/** The serializer's view of `value`. */
export function kindOf(value: unknown): Kind {
  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "number":
      return isSpecialNumber(value) ? "specialNumber" : "primitive";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "function":
      return "function";
    case "object":
      return value === null ? "primitive" : objectKind(value);
    default:
      return "primitive";
  }
}

/** The constructor name of an instance (`Stripe`, `Uint8Array`), or `Object` when the prototype has none. */
export function className(value: object): string {
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto === null || typeof proto !== "object") return "Object";
  const ctor: unknown = Reflect.get(proto, "constructor");
  return typeof ctor === "function" && ctor.name !== "" ? ctor.name : "Object";
}
