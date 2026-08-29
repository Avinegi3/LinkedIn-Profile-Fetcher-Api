import "dotenv/config";

function randomJsessionId(): string {
  const digits = Array.from({ length: 16 }, () => Math.floor(Math.random() * 10)).join("");
  return `ajax:${digits}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

/**
 * Some LinkedIn cookie values (JSESSIONID, bcookie) legitimately include literal double-quote
 * characters as part of the value, e.g. "v=2&<uuid>". An unbalanced quote count almost always
 * means the value was copied incompletely from DevTools, which silently corrupts the Cookie
 * header built from it (everything after the stray quote gets misparsed) — this is a real bug
 * that was hard to notice from the outside, since the request still "goes out" without error,
 * it's just malformed in a way a real browser would never produce.
 */
function warnIfUnbalancedQuotes(name: string, value: string | null): void {
  if (!value) return;
  const quoteCount = (value.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `Warning: ${name} has an unbalanced " character (${quoteCount} total) — it was likely ` +
        "copied incompletely from DevTools. This will corrupt the Cookie header sent to " +
        "LinkedIn. Re-copy the full value, including both surrounding quotes if present."
    );
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  apiKey: process.env.API_KEY || null,
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
    max: Number(process.env.RATE_LIMIT_MAX ?? 20),
  },
  linkedin: {
    // Read lazily via getters so a missing LI_AT_COOKIE only throws when a scrape is
    // actually attempted, not on every server boot (e.g. so `/health` still works).
    get liAt(): string {
      return requireEnv("LI_AT_COOKIE");
    },
    jsessionId: process.env.LI_JSESSIONID || randomJsessionId(),
    // Optional companion cookies from the same browser session as LI_AT_COOKIE. LinkedIn
    // appears to bind a session to the browser fingerprint that created it (a real session
    // got force-logged-out on its very next use from this codebase, with no companion
    // cookies sent) — bcookie/bscookie are long-lived per-browser identifiers a real page
    // load always carries alongside li_at, so sending them too is the best available lever
    // for looking like a continuing browser session rather than a replayed cookie.
    bcookie: process.env.LI_BCOOKIE || null,
    bscookie: process.env.LI_BSCOOKIE || null,
    lidc: process.env.LI_LIDC || null,
  },
};

warnIfUnbalancedQuotes("LI_JSESSIONID", process.env.LI_JSESSIONID || null);
warnIfUnbalancedQuotes("LI_BCOOKIE", config.linkedin.bcookie);
warnIfUnbalancedQuotes("LI_BSCOOKIE", config.linkedin.bscookie);
