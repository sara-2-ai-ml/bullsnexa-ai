import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface AuthConfig {
  readonly username: string;
  readonly password: string;
  /** Signs session cookies. A random per-process secret is used when omitted. */
  readonly sessionSecret?: string;
  /** Session lifetime; defaults to 8 hours. */
  readonly sessionTtlMs?: number;
}

export const SESSION_COOKIE = "bn_session";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * Single shared demo login with a signed, expiring session cookie.
 * This is an access gate for a public demo, NOT user management: there is one
 * account, no roles and no password reset. Comparisons are constant-time.
 */
export class DemoAuth {
  private readonly secret: Buffer;
  private readonly ttlMs: number;
  private readonly expectedUser: Buffer;
  private readonly expectedPassword: Buffer;

  constructor(
    config: AuthConfig,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.secret = Buffer.from(config.sessionSecret ?? randomBytes(32).toString("hex"), "utf8");
    this.ttlMs = config.sessionTtlMs ?? DEFAULT_TTL_MS;
    this.expectedUser = digest(config.username);
    this.expectedPassword = digest(config.password);
  }

  get sessionMaxAgeSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  verifyCredentials(username: string, password: string): boolean {
    const userOk = timingSafeEqual(digest(username), this.expectedUser);
    const passwordOk = timingSafeEqual(digest(password), this.expectedPassword);
    return userOk && passwordOk;
  }

  issueToken(): string {
    const expiresAt = String(this.now() + this.ttlMs);
    return `${expiresAt}.${this.sign(expiresAt)}`;
  }

  verifyToken(token: string | undefined): boolean {
    if (!token) return false;
    const [expiresAt, signature, ...rest] = token.split(".");
    if (!expiresAt || !signature || rest.length > 0) return false;
    if (!/^\d{1,16}$/.test(expiresAt) || !/^[0-9a-f]{64}$/.test(signature)) return false;
    const expected = Buffer.from(this.sign(expiresAt), "hex");
    const given = Buffer.from(signature, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return Number(expiresAt) > this.now();
  }

  private sign(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }
}

/** Minimal Cookie header parser (no dependency); returns one named value. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}
