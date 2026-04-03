import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import authRouter from "./routes/auth.js";
import githubRouter from "./routes/github.js";

const app = express();

// Security headers
app.use(helmet());

// CORS — allow frontend origin with credentials
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
  }),
);

// Body parsing
app.use(express.json());
app.use(cookieParser());

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

// Routes
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/github", githubRouter);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(config.port, () => {
  console.log(`DevPulse API running on http://localhost:${config.port}`);
});

export default app;
