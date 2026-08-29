import express, { Express, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { profileRouter } from "./routes/profile";
import { statusRouter } from "./routes/status";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") }));
  app.use(morgan(config.nodeEnv === "development" ? "dev" : "combined"));
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api", limiter, apiKeyAuth, profileRouter, statusRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
