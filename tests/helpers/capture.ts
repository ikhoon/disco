// Test helper: capture everything a function writes to process.stdout.
// disco's data output goes to stdout (logs go to stderr), so asserting on the
// captured text exercises the same surface users pipe into jq.

export async function captureStdout(fn: () => unknown): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let buf = "";
  (process.stdout as any).write = (chunk: unknown): boolean => {
    buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as Uint8Array);
    return true;
  };
  try {
    await fn();
  } finally {
    (process.stdout as any).write = original;
  }
  return buf;
}

/** Parse the `{ "data": ... }` envelope printed by --json commands. */
export function parseEnvelope(out: string): any {
  return JSON.parse(out).data;
}
