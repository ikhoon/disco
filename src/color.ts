// Subtle ANSI styling for human (text) output.
//
// Color is ON by default and opt-out: enabled when stdout is a TTY, and turned
// off for pipes / redirects / `--json`, or when `--no-color` or the NO_COLOR
// env var (https://no-color.org) is set. The style helpers no-op unless color
// is enabled, so callers wrap unconditionally: `dim(permalink)`, `cyan(author)`.

let enabled = false;

const RESET = "\x1b[0m";
const wrap =
  (open: string) =>
  (s: string): string =>
    enabled && s ? `${open}${s}${RESET}` : s;

/**
 * Decide whether to colorize, once per command before output.
 * On only when: not `--no-color`, not `--json`, NO_COLOR unset, and stdout is
 * a TTY (so piped/redirected output stays clean).
 */
export function configureColor(opts: { noColor?: boolean; json?: boolean } = {}): void {
  enabled =
    !opts.noColor &&
    !opts.json &&
    // NO_COLOR is presence-based (https://no-color.org): any defined value,
    // including an empty string, disables color.
    !("NO_COLOR" in process.env) &&
    Boolean(process.stdout.isTTY);
}

/** Force the flag on/off (for tests). */
export function setColorEnabled(on: boolean): void {
  enabled = on;
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
// Plain red (31), used only for a short "error:" label — not whole lines, which
// read as alarming. Bun's console.error paints the entire line bright red, which
// is why errors/warnings route through log.ts + this instead.
export const red = wrap("\x1b[31m");
