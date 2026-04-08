import { Router, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

const router = Router();

// --- Schemas ---

const createNoteSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
});

// --- List notes ---

router.get("/", requireAuth, async (req: Request, res: Response) => {
  const notes = await prisma.note.findMany({
    where: { userId: req.user!.sub },
    orderBy: { createdAt: "desc" },
  });

  res.json({ notes });
});

// --- Get single note ---

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const note = await prisma.note.findFirst({
    where: { id, userId: req.user!.sub },
  });

  if (!note) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  res.json({ note });
});

// --- Create note ---

router.post(
  "/",
  requireAuth,
  validate(createNoteSchema),
  async (req: Request, res: Response) => {
    const { title, content, pinned } = req.body;

    const note = await prisma.note.create({
      data: {
        title,
        content,
        pinned,
        userId: req.user!.sub,
      },
    });

    res.status(201).json({ note });
  },
);

// --- Update note ---

router.put(
  "/:id",
  requireAuth,
  validate(updateNoteSchema),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);

    const existing = await prisma.note.findFirst({
      where: { id, userId: req.user!.sub },
    });

    if (!existing) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const note = await prisma.note.update({
      where: { id },
      data: req.body,
    });

    res.json({ note });
  },
);

// --- Delete note ---

router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  const existing = await prisma.note.findFirst({
    where: { id, userId: req.user!.sub },
  });

  if (!existing) {
    res.status(404).json({ error: "Note not found" });
    return;
  }

  await prisma.note.delete({ where: { id } });

  res.json({ message: "Note deleted" });
});

export default router;
