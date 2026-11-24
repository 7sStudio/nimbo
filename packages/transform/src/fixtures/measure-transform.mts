// Times transform() and analyze() of the 09 §7 cells in a plain Node process; with --assert it fails past budget × 1.2.
import { analyze, transform } from "../index.js";

const filename = "jsnb:///budget.jsnb/c_1.ts";
const tolerance = 1.2;

/** `lines` lines: half annotated declarations, half functions that call each other (the spike's cell shape). */
function cellOf(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 2) {
    const n = String(i);
    out.push(
      `const v${n}: number = (v${String(i - 2)} ?? 0) + ${n} + helper${String(i % 5)}(${n})`,
    );
    out.push(
      `function helper${String(i % 5)}(n: number) { return n * (helper${String((i + 1) % 5)} ? 2 : 1) }`,
    );
  }
  return out.join("\n");
}

type Measure = {
  readonly name: string;
  readonly run: () => void;
  /** The 09 §7 budget in ms; none for an informational measure. */
  readonly budgetMs?: number;
};

/** Warm samples need a warm process: a bounded burst of runs lets V8 optimise the compiler first. */
function warm(run: () => void): void {
  const until = performance.now() + 400;
  for (let i = 0; i < 25 && performance.now() < until; i += 1) run();
}

function sample(run: () => void): number[] {
  return [0, 1, 2].map(() => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
}

const median = (samples: number[]): number => [...samples].sort((a, b) => a - b)[1] ?? 0;
const fixed = (ms: number): string => ms.toFixed(2);

const long = cellOf(200);
const short = cellOf(20);
const measures: readonly Measure[] = [
  { name: "transform 200-line cell", run: () => transform(long, { filename }), budgetMs: 30 },
  { name: "transform 20-line cell", run: () => transform(short, { filename }), budgetMs: 5 },
  { name: "analyze 200-line cell", run: () => analyze(long) },
];

const results = measures.map((measure) => {
  warm(measure.run);
  const samples = sample(measure.run);
  return {
    name: measure.name,
    samples,
    median: median(samples),
    budgetMs: measure.budgetMs ?? null,
  };
});

const lines = results.map(({ name, samples, median: mid, budgetMs }) => {
  const limit =
    budgetMs === null
      ? "informational"
      : `budget ${String(budgetMs)} ms, limit ${fixed(budgetMs * tolerance)} ms`;
  return `${name}: samples ${samples.map(fixed).join(" / ")} ms, median ${fixed(mid)} ms (${limit})`;
});
const over = results.filter((r) => r.budgetMs !== null && r.median > r.budgetMs * tolerance);
const assert = process.argv.includes("--assert");
process.stdout.write(`${JSON.stringify(results)}\n${lines.join("\n")}\n`);
if (assert && over.length > 0) {
  process.stdout.write(`over budget: ${over.map((r) => r.name).join(", ")}\n`);
  process.exitCode = 1;
}
