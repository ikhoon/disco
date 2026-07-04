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

/** Trace-level; only with --verbose. */
export function debug(...args: unknown[]): void {
  if (VERBOSE) console.error("·", ...args);
}

/** Progress/info; suppressed with --quiet. */
export function info(...args: unknown[]): void {
  if (!QUIET) console.error(...args);
}

/** Warnings/errors; always shown. */
export function warn(...args: unknown[]): void {
  console.error(...args);
}
