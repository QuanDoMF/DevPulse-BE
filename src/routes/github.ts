import { Router, type Request, type Response } from "express";
import axios from "axios";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { encryptToken, decryptToken } from "../lib/crypto.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// All GitHub routes require auth
router.use(requireAuth);

// --- Save GitHub token (encrypted) ---

const tokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

router.put(
  "/token",
  validate(tokenSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.body;

    const encrypted = encryptToken(token);

    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { githubTokenEncrypted: encrypted },
    });

    res.json({ message: "GitHub token saved" });
  },
);

// --- Check if token exists ---

router.get("/token/status", async (req: Request, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { githubTokenEncrypted: true },
  });

  res.json({ configured: !!user?.githubTokenEncrypted });
});

// --- Delete GitHub token ---

router.delete("/token", async (req: Request, res: Response): Promise<void> => {
  await prisma.user.update({
    where: { id: req.user!.sub },
    data: { githubTokenEncrypted: null },
  });

  res.json({ message: "GitHub token removed" });
});

// --- Proxy GitHub API calls ---

async function getDecryptedToken(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubTokenEncrypted: true },
  });

  if (!user?.githubTokenEncrypted) return null;

  try {
    return decryptToken(user.githubTokenEncrypted);
  } catch {
    return null;
  }
}

router.get("/proxy/*", async (req: Request, res: Response): Promise<void> => {
  const token = await getDecryptedToken(req.user!.sub);
  if (!token) {
    res.status(400).json({ error: "GitHub token not configured" });
    return;
  }

  // Extract the GitHub API path after /proxy/
  const githubPath = req.params[0];
  if (!githubPath) {
    res.status(400).json({ error: "Missing GitHub API path" });
    return;
  }

  try {
    const response = await axios.get(`https://api.github.com/${githubPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: req.query,
    });

    res.json(response.data);
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      res.status(err.response.status).json({
        error: "GitHub API error",
        message: err.response.data?.message || "Unknown error",
      });
    } else {
      res.status(500).json({ error: "Failed to proxy GitHub request" });
    }
  }
});

export default router;
