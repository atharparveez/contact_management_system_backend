// routes/pendingContactsRoutes.js
// Provider-agnostic: reads/writes PendingSyncContacts regardless of which
// sync source (google/microsoft) staged a given contact -- shared by every
// provider's "Select"/background sync instead of duplicated per provider.
import express from "express";
import PendingSyncContacts from "../models/pendingSyncContactsModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { performContactsUpload } from "./uploadContactsRoute.js";

const router = express.Router();

/**
 * GET /api/contactSync/pending
 */
router.get("/pending", verifyToken, async (req, res) => {
  try {
    const doc = await PendingSyncContacts.findOne({ userId: req.user.userId });
    res.json({ contacts: doc?.contacts || [] });
  } catch (error) {
    console.error("❌ Error fetching pending contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/contactSync/pending/upload
 * body: { contactIds: string[] }
 */
router.post("/pending/upload", verifyToken, async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ message: "contactIds must be a non-empty array" });
    }

    const doc = await PendingSyncContacts.findOne({ userId: req.user.userId });
    const idSet = new Set(contactIds);
    const chosen = (doc?.contacts || []).filter((c) => idSet.has(c._id.toString()));
    if (chosen.length === 0) return res.status(404).json({ message: "No matching pending contacts found" });

    const result = await performContactsUpload({
      userId: req.user.userId,
      contacts: chosen.map((c) => ({
        fname: c.fname,
        mname: c.mname,
        lname: c.lname,
        workInfo: c.workInfo,
        personalInfo: c.personalInfo,
      })),
      creditPayload: {
        action: "upload",
        points: 5 * chosen.length,
        metadata: { count: chosen.length, source: `${chosen[0]?.source || "contact"}-sync` },
      },
    });

    if (result.status < 300) {
      await PendingSyncContacts.updateOne(
        { userId: req.user.userId },
        { $pull: { contacts: { _id: { $in: chosen.map((c) => c._id) } } } }
      );
    }

    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("❌ Error uploading pending contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/contactSync/pending/discard
 * body: { contactIds: string[] }
 */
router.post("/pending/discard", verifyToken, async (req, res) => {
  try {
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({ message: "contactIds must be a non-empty array" });
    }
    await PendingSyncContacts.updateOne(
      { userId: req.user.userId },
      { $pull: { contacts: { _id: { $in: contactIds } } } }
    );
    res.json({ message: "Discarded" });
  } catch (error) {
    console.error("❌ Error discarding pending contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
