// Stands for what the daemon serves at /npm/<a CommonJS package>: the shape of esbuild's interop
// bundle of a package that sets module.exports, which becomes the default export, with no named exports.
const commonJs = (factory) => {
  const module = { exports: {} };
  factory(module.exports, module);
  return module.exports;
};

const requireDuration = () =>
  commonJs((exports, module) => {
    const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
    module.exports = function duration(text) {
      const match = /^(\d+)(ms|s|m|h)$/.exec(String(text));
      return match ? Number(match[1]) * units[match[2]] : Number.NaN;
    };
    module.exports.units = units;
  });

export default requireDuration();
