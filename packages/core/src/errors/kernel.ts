// The kernel's pre-flight error of 04-kernel §4: a cell imports packages the workspace does not have.
import { JsnbError } from "./jsnbError.js";

type Names = { readonly names: readonly string[] };

const missingPackageMessage = ({ names }: Names): string => {
  const quoted = names.map((name) => `"${name}"`);
  const list =
    quoted.length <= 1
      ? quoted.join("")
      : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  const subject = names.length === 1 ? "Package" : "Packages";
  const verb = names.length === 1 ? "is" : "are";
  return `${subject} ${list} ${verb} not installed. Run: nimbo add ${names.join(" ")}`;
};

export class MissingPackage extends JsnbError {
  declare readonly data: Names;
  constructor(data: Names, options: { readonly cause?: unknown } = {}) {
    super({ name: "MissingPackage", message: missingPackageMessage(data), data, ...options });
  }
}
