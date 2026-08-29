import { Router } from "express";
import { z } from "zod";
import { getLinkedInProfile } from "../linkedin";

export const profileRouter = Router();

const querySchema = z.object({
  url: z.string().min(1, "Query parameter \"url\" is required."),
});

profileRouter.get("/profile", async (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }

  try {
    const profile = await getLinkedInProfile(parsed.data.url);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});
