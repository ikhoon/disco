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

// info/debug write plain text via stderr.write: Bun's console.error paints
// TTY stderr red, which makes routine progress lines look like failures.
// warn keeps console.error so real problems do stand out in red.

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
  console.error(...args);
}
