// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { SignJWT } from "jose";
import { createSession, getSession, deleteSession, verifySession } from "@/lib/auth";
import { NextRequest } from "next/server";

describe("createSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("sets an httpOnly cookie named auth-token", async () => {
    await createSession("user-123", "test@example.com");

    expect(mockCookieStore.set).toHaveBeenCalledOnce();
    const [name, , options] = mockCookieStore.set.mock.calls[0];
    expect(name).toBe("auth-token");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  test("cookie expiry is ~7 days from now", async () => {
    const before = Date.now();
    await createSession("user-123", "test@example.com");
    const after = Date.now();

    const [, , options] = mockCookieStore.set.mock.calls[0];
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    expect(options.expires.getTime()).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(options.expires.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });
});

describe("getSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns null when no auth-token cookie is set", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    const result = await getSession();
    expect(result).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const secret = new TextEncoder().encode("development-secret-key");
    const token = await new SignJWT({ userId: "user-123", email: "test@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(secret);

    mockCookieStore.get.mockReturnValue({ value: token });
    const result = await getSession();
    expect(result?.userId).toBe("user-123");
    expect(result?.email).toBe("test@example.com");
  });

  test("returns null for an invalid token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "invalid.token.here" });
    const result = await getSession();
    expect(result).toBeNull();
  });
});

describe("deleteSession", () => {
  beforeEach(() => vi.clearAllMocks());

  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledOnce();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  function makeRequest(token?: string): NextRequest {
    const url = "http://localhost/";
    const req = new NextRequest(url);
    if (token) {
      req.cookies.set("auth-token", token);
    }
    return req;
  }

  test("returns null when no auth-token cookie is present", async () => {
    const result = await verifySession(makeRequest());
    expect(result).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    const secret = new TextEncoder().encode("development-secret-key");
    const token = await new SignJWT({ userId: "user-456", email: "verify@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("7d")
      .sign(secret);

    const result = await verifySession(makeRequest(token));
    expect(result?.userId).toBe("user-456");
    expect(result?.email).toBe("verify@example.com");
  });

  test("returns null for a tampered or invalid token", async () => {
    const result = await verifySession(makeRequest("bad.token.value"));
    expect(result).toBeNull();
  });

  test("returns null for an expired token", async () => {
    const secret = new TextEncoder().encode("development-secret-key");
    const token = await new SignJWT({ userId: "user-789", email: "expired@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(0)
      .sign(secret);

    const result = await verifySession(makeRequest(token));
    expect(result).toBeNull();
  });
});
