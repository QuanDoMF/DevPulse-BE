import { Router, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// --- Schemas ---

const createTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  body: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  projectId: z.number().int().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  body: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  projectId: z.number().int().optional().nullable(),
});

// --- List tasks ---

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const where: Record<string, unknown> = { userId: req.user!.sub };

  if (req.query.projectId) {
    where.projectId = Number(req.query.projectId);
  }
  if (req.query.status) {
    where.status = req.query.status as string;
  }

  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  res.json({ tasks });
});

// --- Get single task ---

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const task = await prisma.task.findFirst({
    where: { id, userId: req.user!.sub },
  });

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({ task });
});

// --- Create task ---

router.post(
  "/",
  requireAuth,
  validate(createTaskSchema),
  async (req: Request, res: Response) => {
    const { title, body, status, priority, dueDate, projectId } = req.body;

    // Verify project ownership if projectId provided
    if (projectId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: req.user!.sub },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
    }

    const task = await prisma.task.create({
      data: {
        title,
        body,
        status,
        priority,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        projectId,
        userId: req.user!.sub,
      },
    });

    res.status(201).json({ task });
  },
);

// --- Update task ---

router.put(
  "/:id",
  requireAuth,
  validate(updateTaskSchema),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);

    const existing = await prisma.task.findFirst({
      where: { id, userId: req.user!.sub },
    });

    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    // Verify project ownership if projectId is being updated
    if (req.body.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: req.body.projectId, userId: req.user!.sub },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
    }

    const data = { ...req.body };
    if (data.dueDate !== undefined) {
      data.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    const task = await prisma.task.update({
      where: { id },
      data,
    });

    res.json({ task });
  },
);

// --- Delete task ---

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const existing = await prisma.task.findFirst({
    where: { id, userId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  await prisma.task.delete({ where: { id } });

  res.json({ message: "Task deleted" });
});

export default router;
