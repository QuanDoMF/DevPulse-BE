import { Router, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// --- Schemas ---

const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  status: z.string().optional(),
  repoUrl: z.string().url("Invalid URL").optional().or(z.literal("")),
});

const updateProjectSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  repoUrl: z.string().url("Invalid URL").optional().or(z.literal("")),
});

// --- List projects ---

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const projects = await prisma.project.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: "desc" },
  });

  res.json({ projects });
});

// --- Get single project ---

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const project = await prisma.project.findFirst({
    where: { id, userId: req.user!.sub },
    include: { tasks: true },
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ project });
});

// --- Create project ---

router.post(
  "/",
  requireAuth,
  validate(createProjectSchema),
  async (req: Request, res: Response) => {
    const { name, description, status, repoUrl } = req.body;

    const project = await prisma.project.create({
      data: {
        name,
        description,
        status,
        repoUrl: repoUrl || undefined,
        userId: req.user!.sub,
      },
    });

    res.status(201).json({ project });
  },
);

// --- Update project ---

router.put(
  "/:id",
  requireAuth,
  validate(updateProjectSchema),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);

    const existing = await prisma.project.findFirst({
      where: { id, userId: req.user!.sub },
    });

    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const project = await prisma.project.update({
      where: { id },
      data: req.body,
    });

    res.json({ project });
  },
);

// --- Delete project ---

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const existing = await prisma.project.findFirst({
    where: { id, userId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await prisma.project.delete({ where: { id } });

  res.json({ message: "Project deleted" });
});

export default router;
