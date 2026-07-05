import { describe, expect, test, afterEach } from "bun:test";
import { configureColor, setColorEnabled, colorIsEnabled, dim, yellow } from "../src/color.ts";

const origTTY = process.stdout.isTTY;

afterEach(() => {
  (process.stdout as unknown as { isTTY: boolean }).isTTY = origTTY;
  delete process.env.NO_COLOR;
  setColorEnabled(false);
});

describe("color gating", () => {
  test("style helpers wrap when enabled, pass through when not", () => {
    setColorEnabled(true);
    expect(dim("x")).toBe("\x1b[90mx\x1b[0m");
    setColorEnabled(false);
    expect(dim("x")).toBe("x");
  });

  test("never styles an empty string", () => {
    setColorEnabled(true);
    expect(yellow("")).toBe("");
  });

  test("is ON by default on a TTY", () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
    configureColor({});
    expect(colorIsEnabled()).toBe(true);
  });

  test("is OFF for --no-color, JSON, NO_COLOR, or a non-TTY", () => {
    (process.stdout as unknown as { isTTY: boolean }).isTTY = true;

    configureColor({ noColor: true });
    expect(colorIsEnabled()).toBe(false);

    configureColor({ json: true });
    expect(colorIsEnabled()).toBe(false);

    process.env.NO_COLOR = ""; // presence-based: even an empty value disables
    configureColor({});
    expect(colorIsEnabled()).toBe(false);
    delete process.env.NO_COLOR;

    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
    configureColor({});
    expect(colorIsEnabled()).toBe(false);
  });
});
