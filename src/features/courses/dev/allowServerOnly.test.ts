import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowServerOnly, nodeTooOldSentence } from "./allowServerOnly";

const req = createRequire(import.meta.url);
const serverOnlyFile = req.resolve("server-only");

afterEach(() => {
  delete req.cache[serverOnlyFile];
});

describe("allowServerOnly", () => {
  it("uses registerHooks when Node has it, adding react-server for server-only alone", () => {
    const registerHooks = vi.fn();
    expect(allowServerOnly({ registerHooks }, req)).toBe("hooks");
    const { resolve } = registerHooks.mock.calls[0][0];
    const nextResolve = vi.fn((specifier: string, context: { conditions?: string[] }) => ({ url: specifier, context }));

    resolve("server-only", { conditions: ["node"] }, nextResolve);
    expect(nextResolve).toHaveBeenLastCalledWith("server-only", { conditions: ["node", "react-server"] });
    resolve("next/link", { conditions: ["node"] }, nextResolve);
    expect(nextResolve).toHaveBeenLastCalledWith("next/link", { conditions: ["node"] });
    expect(req.cache[serverOnlyFile]).toBeUndefined();
  });

  it("on Node without registerHooks (20, early 22), makes require('server-only') an empty module", () => {
    // Without the fix, the real package throws as it does outside a server build.
    expect(() => req("server-only")).toThrow();
    delete req.cache[serverOnlyFile];

    expect(allowServerOnly({}, req)).toBe("require-cache");
    expect(req("server-only")).toEqual({});
  });

  it("names the Node version to use when it cannot help", () => {
    expect(nodeTooOldSentence("v18.0.0")).toMatch(/Node v18\.0\.0.*Node 22\.15 or newer/);
  });
});
