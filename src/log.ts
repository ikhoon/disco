// Logging goes to stderr so stdout stays clean for --json piping.

let VERBOSE = false;
let QUIET = false;

export function configureLog(opts: { verbose?: boolean; quiet?: boolean }): void {
  VERBOSE = !!opts.verbose;
  QUIET = !!opts.quiet;
}

export function isVerbose(): boolean {
  return VERBOSE;
}

// All three write plain text via stderr.write. We deliberately avoid
// console.error: Bun paints the entire console.error line bright red on a TTY,
// which makes routine logs look like failures and real errors look alarming.
// Callers add their own restrained accent (e.g. a red "error:" label) via color.ts.

/** Trace-level; only with --verbose. */
export function debug(...args: unknown[]): void {
  if (VERBOSE) process.stderr.write("· " + args.map(String).join(" ") + "\n");
}

/** Progress/info; suppressed with --quiet. */
export function info(...args: unknown[]): void {
  if (!QUIET) process.stderr.write(args.map(String).join(" ") + "\n");
}

/** Warnings/errors; always shown. */
export function warn(...args: unknown[]): void {
  process.stderr.write(args.map(String).join(" ") + "\n");
}
