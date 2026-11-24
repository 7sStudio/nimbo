// Types of fixtures/modules/cjs-package.js: one default export, the package's module.exports.
declare const duration: ((text: string) => number) & {
  readonly units: Readonly<Record<string, number>>;
};
export default duration;
