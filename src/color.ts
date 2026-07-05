// Subtle ANSI styling for human (text) output.
//
// Color is ON by default and opt-out: enabled when the target stream is a TTY,
// and turned off for pipes / redirects / `--json`, or when `--no-color` or the
// NO_COLOR env var (https://no-color.org) is set. The style helpers no-op unless
// color is enabled, so callers wrap unconditionally: `dim(permalink)`,
// `cyan(author)`. Data-output helpers gate on stdout; stderr (logs/errors) gates
// on stderr independently, so `disco … 2>err.log` never leaks ANSI into the file.

let enabled = false; // stdout (data) coloring
let stderrEnabled = false; // stderr (log/error) coloring

const RESET = "\x1b[0m";
const wrap =
  (open: string) =>
  (s: string): string =>
    enabled && s ? `${open}${s}${RESET}` : s;

/**
 * Decide whether to colorize, once per command before output. On only when: not
 * `--no-color`, not `--json`, NO_COLOR unset, and the target stream is a TTY —
 * evaluated per stream so piped/redirected output on either stays clean.
 */
export function configureColor(opts: { noColor?: boolean; json?: boolean } = {}): void {
  const userWantsColor =
    !opts.noColor &&
    !opts.json &&
    // NO_COLOR is presence-based (https://no-color.org): any defined value,
    // including an empty string, disables color.
    !("NO_COLOR" in process.env);
  enabled = userWantsColor && Boolean(process.stdout.isTTY);
  stderrEnabled = userWantsColor && Boolean(process.stderr.isTTY);
}

/** Force the flags on/off (for tests). */
export function setColorEnabled(on: boolean): void {
  enabled = on;
  stderrEnabled = on;
}

export function colorIsEnabled(): boolean {
  return enabled;
}

export const bold = wrap("\x1b[1m");
// Secondary text: bright-black (a readable gray) rather than SGR 2 "faint",
// which many terminals render as washed-out/low-contrast.
export const dim = wrap("\x1b[90m");
// Bright (90–97) foregrounds — more legible on dark terminals than the muted
// 30–37 set.
export const yellow = wrap("\x1b[93m");
export const cyan = wrap("\x1b[96m");
export const green = wrap("\x1b[92m");

/**
 * Plain red (31) for a short "error:" label on stderr — not whole lines, which
 * read as alarming (Bun's console.error paints the entire line bright red). Gated
 * on stderr's own TTY state so a redirected `2>file` stays free of escape codes.
 */
export function stderrRed(s: string): string {
  return stderrEnabled && s ? `\x1b[31m${s}${RESET}` : s;
}
