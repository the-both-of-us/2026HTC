import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserId, readUserId } from "./identity";

const cookieJar = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => {
  cookieJar.set(name, value);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: setCookie,
  }),
}));

beforeEach(() => {
  cookieJar.clear();
  setCookie.mockClear();
});

describe("getUserId", () => {
  it("creates an httpOnly, SameSite=Lax, one year cookie when there is none", async () => {
    const id = await getUserId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toHaveBeenCalledWith(
      "pf_uid",
      id,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 31536000, path: "/" }),
    );
  });

  it("returns the existing id without setting the cookie again", async () => {
    const first = await getUserId();
    setCookie.mockClear();

    expect(await getUserId()).toBe(first);
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("replaces a cookie that is not a UUID", async () => {
    cookieJar.set("pf_uid", "../../someone-else");

    const id = await getUserId();

    expect(id).not.toContain("..");
    expect(setCookie).toHaveBeenCalledOnce();
  });
});

describe("readUserId", () => {
  it("returns null and never sets a cookie when there is none", async () => {
    expect(await readUserId()).toBeNull();
    expect(setCookie).not.toHaveBeenCalled();
  });
});
