import { NextFunction, Request, Response } from "express";

/**
 * Maps our typed domain errors to HTTP status codes by class name. Kept as one lookup
 * table so adding a new error type is a one-line change instead of another if/else branch.
 */
const STATUS_BY_ERROR_NAME: Record<string, number> = {
  InvalidProfileUrlError: 400,
  LinkedInAuthError: 502,
  LinkedInProfileNotFoundError: 404,
  LinkedInRateLimitError: 429,
  LinkedInRequestError: 502,
};

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found." });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const error = err instanceof Error ? err : new Error("Unknown error");
  const status = STATUS_BY_ERROR_NAME[error.name] ?? 500;

  if (status === 500) {
    // eslint-disable-next-line no-console
    console.error(error);
  }

  res.status(status).json({
    error: error.message,
    type: error.name,
  });
}
