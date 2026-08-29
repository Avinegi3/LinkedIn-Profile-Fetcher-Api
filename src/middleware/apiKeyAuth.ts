import { NextFunction, Request, Response } from "express";
import { config } from "../config";

/**
 * Guards routes with a shared-secret API key when API_KEY is configured. Every request
 * against this service spends the operator's LinkedIn session's rate-limit budget, so an
 * unauthenticated public deployment risks that account being flagged; this is a cheap way
 * to keep the hosted instance private to its owner while still being publicly reachable.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.apiKey) {
    next();
    return;
  }

  const provided = req.header("x-api-key");
  if (provided !== config.apiKey) {
    res.status(401).json({ error: "Missing or invalid x-api-key header." });
    return;
  }

  next();
}
