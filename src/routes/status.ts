import { Router } from "express";
import { checkSession } from "../linkedin";

export const statusRouter = Router();

/** Confirms the configured LI_AT_COOKIE is still accepted by LinkedIn, without a full profile fetch. */
statusRouter.get("/status", async (_req, res, next) => {
  try {
    const result = await checkSession();
    res.json({ linkedinSession: "valid", memberId: result.memberId ?? null });
  } catch (error) {
    next(error);
  }
});
