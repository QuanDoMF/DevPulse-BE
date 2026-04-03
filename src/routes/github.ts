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
    try {
      const { token } = req.body;
      const encrypted = encryptToken(token);

      await prisma.user.update({
        where: { id: req.user!.sub },
        data: { githubTokenEncrypted: encrypted },
      });

      res.json({ message: "GitHub token saved" });
    } catch (err) {
      console.error("Save token error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Check if token exists ---

router.get("/token/status", async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { githubTokenEncrypted: true },
    });

    res.json({ configured: !!user?.githubTokenEncrypted });
  } catch (err) {
    console.error("Token status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Delete GitHub token ---

router.delete("/token", async (req: Request, res: Response): Promise<void> => {
  try {
    await prisma.user.update({
      where: { id: req.user!.sub },
      data: { githubTokenEncrypted: null },
    });

    res.json({ message: "GitHub token removed" });
  } catch (err) {
    console.error("Delete token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Proxy GitHub API calls ---

// Whitelist: only allow repos-scoped paths
const ALLOWED_PATH_PATTERN = /^repos\/[\w.\-]+\/[\w.\-]+\/(events|commits|pulls|issues|stats\/commit_activity)(\/[\w.\-]+)?$/;
const ALLOWED_QUERY_PARAMS = new Set([
  "page", "per_page", "since", "until", "state", "sort", "direction",
]);

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

router.get("/proxy/{*path}", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await getDecryptedToken(req.user!.sub);
    if (!token) {
      res.status(400).json({ error: "GitHub token not configured" });
      return;
    }

    const rawPath = req.params.path;
    const githubPath = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath);
    if (!githubPath) {
      res.status(400).json({ error: "Missing API path" });
      return;
    }

    // Validate path against whitelist
    if (!ALLOWED_PATH_PATTERN.test(githubPath)) {
      res.status(400).json({ error: "Invalid API path" });
      return;
    }

    // Filter query params to whitelist only
    const filteredParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (ALLOWED_QUERY_PARAMS.has(key) && typeof value === "string") {
        filteredParams[key] = value;
      }
    }

    const response = await axios.get(`https://api.github.com/${githubPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      params: filteredParams,
    });

    res.json(response.data);
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response) {
      const status = err.response.status;
      if (status === 401 || status === 403) {
        res.status(401).json({ error: "GitHub authentication failed" });
      } else if (status === 404) {
        res.status(404).json({ error: "Repository or resource not found" });
      } else if (status === 429) {
        res.status(429).json({ error: "GitHub API rate limit exceeded" });
      } else {
        res.status(502).json({ error: "Failed to fetch data from GitHub" });
      }
    } else {
      console.error("GitHub proxy error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
