import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed access tokens: `base64url(claims).base64url(HMAC-SHA256(claims))`.
 *
 * Whatever issues tokens (an app backend, after the user signs in) shares the secret with
 * the sync server. The sync server only verifies: it never stores sessions or passwords.
 * A token grants one role on one document (or "*" for all) until it expires.
 */
export type Role = "editor" | "viewer";

export interface TokenClaims {
  /** Document id, or "*" for every document. */
  readonly doc: string;
  /** Who this is (user id), for logs and auditing. */
  readonly sub: string;
  readonly role: Role;
  /** Expiry, seconds since the epoch. */
  readonly exp: number;
}

const b64 = (data: string | Buffer): string => Buffer.from(data).toString("base64url");

function mac(secret: string, body: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signToken(secret: string, claims: TokenClaims): string {
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The claims if the token is valid for `docId` now, otherwise a reason it isn't. */
export function verifyToken(secret: string, token: string, docId: string, nowMs = Date.now()): TokenClaims | string {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return "malformed token";
  const expected = mac(secret, body);
  const given = Buffer.from(signature, "base64url");
  // Constant-time compare: don't leak how many signature bytes matched.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad token signature";

  let claims: Partial<TokenClaims>;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TokenClaims>;
  } catch {
    return "malformed token";
  }
  if (typeof claims.doc !== "string" || typeof claims.sub !== "string" || typeof claims.exp !== "number") {
    return "malformed token";
  }
  if (claims.role !== "editor" && claims.role !== "viewer") return "malformed token";
  if (claims.exp * 1000 <= nowMs) return "token expired";
  if (claims.doc !== "*" && claims.doc !== docId) return "token is for another document";
  return { doc: claims.doc, sub: claims.sub, role: claims.role, exp: claims.exp };
}
