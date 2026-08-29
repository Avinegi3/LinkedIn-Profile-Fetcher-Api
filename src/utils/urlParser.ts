/**
 * Accepts the many shapes LinkedIn profile URLs show up in (www/mobile/no subdomain,
 * with/without protocol, trailing slash, query string, locale prefix) and extracts the
 * public identifier used by the Voyager API, e.g. "jane-doe-1234ab567" from
 * "https://www.linkedin.com/in/jane-doe-1234ab567/".
 */
export function extractPublicIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidProfileUrlError("URL is empty.");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new InvalidProfileUrlError(`"${input}" is not a valid URL.`);
  }

  const host = url.hostname.toLowerCase();
  const isLinkedInHost = host === "linkedin.com" || host.endsWith(".linkedin.com");
  if (!isLinkedInHost) {
    throw new InvalidProfileUrlError(`"${input}" is not a linkedin.com URL.`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const inIndex = segments.indexOf("in");
  if (inIndex === -1 || !segments[inIndex + 1]) {
    throw new InvalidProfileUrlError(
      `"${input}" doesn't look like a profile URL (expected a "/in/<public-id>" path).`
    );
  }

  const publicIdentifier = decodeURIComponent(segments[inIndex + 1]);
  if (!/^[a-zA-Z0-9\-_%]+$/.test(publicIdentifier)) {
    throw new InvalidProfileUrlError(`Could not extract a valid public identifier from "${input}".`);
  }

  return publicIdentifier;
}

export class InvalidProfileUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileUrlError";
  }
}
