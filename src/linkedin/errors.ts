export class LinkedInAuthError extends Error {
  constructor(message = "LinkedIn session cookie is missing, invalid, or expired.") {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

export class LinkedInProfileNotFoundError extends Error {
  constructor(publicIdentifier: string) {
    super(`No LinkedIn profile found for "${publicIdentifier}" (or it is private/restricted).`);
    this.name = "LinkedInProfileNotFoundError";
  }
}

export class LinkedInRateLimitError extends Error {
  constructor(message = "LinkedIn rate-limited or challenged this request (e.g. CAPTCHA/checkpoint).") {
    super(message);
    this.name = "LinkedInRateLimitError";
  }
}

export class LinkedInRequestError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "LinkedInRequestError";
    this.status = status;
  }
}
