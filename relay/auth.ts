// Demo access protection (not an account system): a role access code is exchanged once for an
// HttpOnly session cookie. Only SHA-256 hashes of session tokens are kept (memory + auth.json, so a
// relay restart does not log everybody out). Access codes never appear in URLs, builds or logs.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "../src/contracts/envelope.ts";

export type Principal = { role: Role; sessionId: string; clientId: string; clientName: string | null; expiresAt: string };

const sha = (s: string) => createHash("sha256").update(s).digest();
const hex = (s: string) => sha(s).toString("hex");

export class Auth {
  private tokens = new Map<string, Principal>();
  private readonly file: string;
  private readonly codes: Partial<Record<Role, string>>;
  private readonly ttlMs: number;

  constructor(dataDir: string, codes: Partial<Record<Role, string>>, ttlMs: number) {
    this.file = join(dataDir, "auth.json");
    this.codes = codes;
    this.ttlMs = ttlMs;
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as Record<string, Principal>;
      for (const [h, p] of Object.entries(raw)) if (Date.parse(p.expiresAt) > Date.now()) this.tokens.set(h, p);
    }
  }

  roleEnabled(role: Role) {
    return this.codes[role] !== undefined;
  }

  /** Constant-time comparison of the access code for a role. */
  checkCode(role: Role, code: string): boolean {
    const expected = this.codes[role];
    if (expected === undefined) return false;
    return timingSafeEqual(sha(expected), sha(code));
  }

  issue(role: Role, sessionId: string, clientName: string | null): { token: string; principal: Principal } {
    const token = randomBytes(32).toString("base64url");
    const principal: Principal = { role, sessionId, clientId: randomUUID(), clientName, expiresAt: new Date(Date.now() + this.ttlMs).toISOString() };
    this.tokens.set(hex(token), principal);
    this.persist();
    return { token, principal };
  }

  verify(token: string | undefined): Principal | null {
    if (!token) return null;
    const p = this.tokens.get(hex(token));
    if (!p) return null;
    if (Date.parse(p.expiresAt) <= Date.now()) {
      this.tokens.delete(hex(token));
      return null;
    }
    return p;
  }

  revoke(token: string | undefined) {
    if (token && this.tokens.delete(hex(token))) this.persist();
  }

  private persist() {
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.tokens)));
    renameSync(tmp, this.file);
  }
}
