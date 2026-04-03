import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { config } from "../config.js";

const router = Router();

const BCRYPT_ROUNDS = 12;
// Dummy hash for constant-time comparison when user not found
const DUMMY_HASH = "$2a$12$R9h7cIPz0gi.URNNX3kh2OPST9EBkj2MvvXfb0vZMEJmWVvjV32qy";

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  const isProduction = config.nodeEnv === "production";

  res.cookie("devpulse_access_token", accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });

  res.cookie("devpulse_refresh_token", refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookies(res: Response) {
  res.clearCookie("devpulse_access_token", { path: "/" });
  res.clearCookie("devpulse_refresh_token", { path: "/" });
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// --- Register ---

const registerSchema = z.object({
  email: z.string().email("Invalid email"),
  name: z.string().min(1).optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post(
  "/register",
  validate(registerSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, name, password } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        // Generic error to prevent user enumeration
        res.status(400).json({ error: "Registration failed" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const user = await prisma.user.create({
        data: { email, name, passwordHash },
      });

      const payload = { sub: user.id, email: user.email };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          refreshToken: hashToken(refreshToken),
          refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      setAuthCookies(res, accessToken, refreshToken);

      res.status(201).json({
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      });
    } catch (err) {
      console.error("Register error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Login ---

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

router.post(
  "/login",
  validate(loginSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });

      // Constant-time: always run bcrypt.compare even if user not found
      const passwordHash = user?.passwordHash || DUMMY_HASH;
      const valid = await bcrypt.compare(password, passwordHash);

      if (!user || !valid) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const payload = { sub: user.id, email: user.email };
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          refreshToken: hashToken(refreshToken),
          refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      setAuthCookies(res, accessToken, refreshToken);

      res.json({
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Refresh ---

router.post("/refresh", async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.devpulse_refresh_token;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);
    const hashed = hashToken(token);

    const user = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        refreshToken: hashed,
        refreshTokenExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      clearAuthCookies(res);
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Rotate tokens
    const newPayload = { sub: user.id, email: user.email };
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: hashToken(newRefreshToken),
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setAuthCookies(res, newAccessToken, newRefreshToken);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    });
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: "Authentication required" });
  }
});

// --- Logout ---

router.post("/logout", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { refreshToken: null, refreshTokenExpiresAt: null },
    });

    clearAuthCookies(res);
    res.json({ message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Me ---

router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });

    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error("Auth check error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
