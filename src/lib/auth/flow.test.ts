import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as quote } from "@/app/api/quote/route";
import { POST as run } from "@/app/api/run/route";
import { proxy } from "@/proxy";
import { RUNS_MAX_PER_SESSION, resetLimits } from "./limits";
import { csrfToken, verifySession } from "./session";

const PW = "test-password-123456";
const H = { host: "localhost:3000", origin: "http://localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.7" };
const KEYS = ["REVIEWS_ADMIN_PASSWORD", "LOOOT_REVIEWS_DATA_DIR", "NEXT_PUBLIC_DEMO", "LOOOT_TOKEN", "LOOOT_API_URL", "REVIEWS_SPEND_CAP_USD", "REVIEWS_LLM_API_KEY"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => /reviews_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0] ?? "";

/** A fake looot server. Counts paid runs and returns a completed run at $0.001. */
let fake: Server;
let paidRuns = 0;
beforeAll(async () => {
  fake = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url?.startsWith("/v1/public-catalog/")) return void res.end(JSON.stringify({ price: { state: "known", amountMicros: 1000, unit: "call" } }));
    if (req.method === "POST" && req.url?.startsWith("/v1/runs")) {
      paidRuns++;
      return void res.end(JSON.stringify({ runId: `r${paidRuns}`, status: "completed", result: {}, actualCost: 0.001 }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((ok) => fake.listen(0, "127.0.0.1", ok));
});
afterAll(() => new Promise<void>((ok) => fake.close(() => ok())));

let dataDir = "";
beforeEach(() => {
  mkdirSync(join(process.cwd(), ".vitest"), { recursive: true });
  dataDir = mkdtempSync(join(process.cwd(), ".vitest", "flow-"));
  process.env.LOOOT_REVIEWS_DATA_DIR = dataDir;
  process.env.REVIEWS_ADMIN_PASSWORD = PW;
  process.env.LOOOT_TOKEN = "lt_fake_token_for_tests";
  process.env.LOOOT_API_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  delete process.env.NEXT_PUBLIC_DEMO;
  delete process.env.REVIEWS_SPEND_CAP_USD;
  delete process.env.REVIEWS_LLM_API_KEY;
  paidRuns = 0;
  resetLimits();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function session() {
  const res = await login(post("/api/auth/login", { password: PW }));
  const cookie = cookieOf(res);
  const s = (await verifySession(process.env, cookie.split("=")[1]))!;
  return { cookie, token: await csrfToken(process.env, s.sid) };
}
const RUN = { target: "Blue Door Cafe @ Austin TX", competitors: "", pages: 1, confirmedMaxMicros: 3_000_000 };

describe("sign in", () => {
  it("a wrong password gets 401 and no cookie", async () => {
    const res = await login(post("/api/auth/login", { password: "nope-nope-nope-nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("the right password sets a hardened cookie that opens admin routes", async () => {
    const res = await login(post("/api/auth/login", { password: PW }));
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Max-Age=/);
    const page = await proxy(new NextRequest("http://localhost:3000/themes", { headers: { cookie: cookieOf(res) } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store");
  });
  it("a form post redirects to the page asked for, and never off site", async () => {
    const form = (next: string) => new Request("http://localhost:3000/api/auth/login", { method: "POST", headers: { host: H.host, origin: H.origin, "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": H["x-forwarded-for"] }, body: new URLSearchParams({ password: PW, next }) });
    expect((await login(form("/themes"))).headers.get("location")).toBe("/themes");
    expect((await login(form("//evil.example"))).headers.get("location")).toBe("/");
    expect((await login(form("https://evil.example"))).headers.get("location")).toBe("/");
  });
  it("locks the address after 5 wrong passwords, and the right password does not help until the window ends", async () => {
    for (let i = 0; i < 5; i++) expect((await login(post("/api/auth/login", { password: `wrong-password-${i}-xx` }))).status).toBe(401);
    const locked = await login(post("/api/auth/login", { password: PW }));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
  });
  it("refuses a sign-in posted from another site", async () => {
    expect((await login(post("/api/auth/login", { password: PW }, { origin: "https://evil.example" }))).status).toBe(403);
  });
  it("sign out clears the cookie, and only for a same-site request", async () => {
    expect((await logout(post("/api/auth/logout", {}))).headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await logout(post("/api/auth/logout", {}, { origin: "https://evil.example" }))).status).toBe(403);
  });
});

describe("CSRF on the paid route", () => {
  it("rejects a cross-site origin even with a valid session", async () => {
    const { cookie, token } = await session();
    expect((await run(post("/api/run", RUN, { cookie, "x-reviews-csrf": token, origin: "https://evil.example" }))).status).toBe(403);
    expect(paidRuns).toBe(0);
  });
  it("rejects a same-origin request without the token, or with a wrong one", async () => {
    const { cookie } = await session();
    expect((await run(post("/api/run", RUN, { cookie }))).status).toBe(403);
    expect((await run(post("/api/run", RUN, { cookie, "x-reviews-csrf": "AAAA" }))).status).toBe(403);
    expect(paidRuns).toBe(0);
  });
  it("a request with no Origin and no fetch metadata is refused", async () => {
    const { cookie, token } = await session();
    const res = await run(new Request("http://localhost:3000/api/run", { method: "POST", headers: { host: H.host, cookie, "x-reviews-csrf": token, "content-type": "application/json" }, body: JSON.stringify(RUN) }));
    expect(res.status).toBe(403);
  });
  it("a quote also needs the token", async () => {
    const { cookie } = await session();
    expect((await quote(post("/api/quote", RUN, { cookie }))).status).toBe(403);
  });
});

describe("money", () => {
  it("the caller cannot set the cap: maxSpendUsd and capUsd in the body are ignored", async () => {
    process.env.REVIEWS_SPEND_CAP_USD = "0.002";
    const { cookie, token } = await session();
    const res = await run(post("/api/run", { ...RUN, maxSpendUsd: 100, capUsd: 100, cap: 100, capMicros: 100_000_000 }, { cookie, "x-reviews-csrf": token }));
    expect(res.status).toBe(200);
    const saved = JSON.parse(readFileSync(join(dataDir, "latest.json"), "utf8")) as { capMicros: number; spendMicros: number };
    expect(saved.capMicros).toBe(2000);
    expect(saved.spendMicros).toBeLessThanOrEqual(2000);
    expect(paidRuns).toBeLessThanOrEqual(2);
  });
  it("the quote shows the server's cap, not the caller's", async () => {
    process.env.REVIEWS_SPEND_CAP_USD = "0.002";
    const { cookie, token } = await session();
    const res = await quote(post("/api/quote", { ...RUN, maxSpendUsd: 100 }, { cookie, "x-reviews-csrf": token }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { plan: { capMicros: number } }).plan.capMicros).toBe(2000);
  });
  it("a bad server cap falls back to the default of 50 cents", async () => {
    process.env.REVIEWS_SPEND_CAP_USD = "lots";
    const { cookie, token } = await session();
    const res = await quote(post("/api/quote", RUN, { cookie, "x-reviews-csrf": token }));
    expect(((await res.json()) as { plan: { capMicros: number } }).plan.capMicros).toBe(500_000);
  });
  it("a run is refused when the live total is above the confirmed total", async () => {
    const { cookie, token } = await session();
    const res = await run(post("/api/run", { ...RUN, confirmedMaxMicros: 1 }, { cookie, "x-reviews-csrf": token }));
    expect(res.status).toBe(409);
    expect(paidRuns).toBe(0);
  });
  it("limits pulls per session", async () => {
    const { cookie, token } = await session();
    const go = () => run(post("/api/run", RUN, { cookie, "x-reviews-csrf": token }));
    for (let i = 0; i < RUNS_MAX_PER_SESSION; i++) expect((await go()).status, `pull ${i + 1}`).toBe(200);
    const blocked = await go();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const other = await session();
    expect((await run(post("/api/run", RUN, { cookie: other.cookie, "x-reviews-csrf": other.token }))).status).toBe(200);
  });
});

describe("demo", () => {
  it("is open without a sign-in when there is no token, no LLM key and no saved pull", async () => {
    delete process.env.REVIEWS_ADMIN_PASSWORD;
    delete process.env.LOOOT_TOKEN;
    process.env.NEXT_PUBLIC_DEMO = "1";
    process.env.LOOOT_REVIEWS_DATA_DIR = join(dataDir, "empty");
    const res = await proxy(new NextRequest("http://localhost:3000/new"));
    expect(res.status).toBe(200);
  });
});
