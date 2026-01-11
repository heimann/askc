import { describe, test, expect } from "bun:test";
import { getBackend, getDefaultBackend } from "../src/backends/index.js";

describe("Backend Registry", () => {
  test("getDefaultBackend returns opencode", () => {
    // Clear any env override
    const original = process.env.ASKC_BACKEND;
    delete process.env.ASKC_BACKEND;

    expect(getDefaultBackend()).toBe("opencode");

    // Restore
    if (original) process.env.ASKC_BACKEND = original;
  });

  test("getDefaultBackend respects ASKC_BACKEND env", () => {
    const original = process.env.ASKC_BACKEND;
    process.env.ASKC_BACKEND = "pi";

    expect(getDefaultBackend()).toBe("pi");

    // Restore
    if (original) {
      process.env.ASKC_BACKEND = original;
    } else {
      delete process.env.ASKC_BACKEND;
    }
  });

  test("getBackend returns correct backend", () => {
    const opencode = getBackend("opencode");
    expect(opencode.name).toBe("opencode");

    const pi = getBackend("pi");
    expect(pi.name).toBe("pi");

    const claude = getBackend("claude");
    expect(claude.name).toBe("claude");
  });

  test("getBackend throws for unknown backend", () => {
    expect(() => getBackend("unknown" as any)).toThrow("Unknown backend: unknown");
  });

  test("backends have runQuery method", () => {
    const opencode = getBackend("opencode");
    expect(typeof opencode.runQuery).toBe("function");

    const pi = getBackend("pi");
    expect(typeof pi.runQuery).toBe("function");

    const claude = getBackend("claude");
    expect(typeof claude.runQuery).toBe("function");
  });
});
