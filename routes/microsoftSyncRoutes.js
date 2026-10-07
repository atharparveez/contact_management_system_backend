// routes/microsoftSyncRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/userModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { exchangeCodeForTokens, syncUserMicrosoftContacts } from "../services/microsoftContactsService.js";
dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const WEB_MICROSOFT_SYNC_CALLBACK_URL = process.env.WEB_MICROSOFT_SYNC_CALLBACK_URL;

/**
 * GET /api/microsoftSync/status
 */
router.get("/status", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("microsoftSync");
    res.json({
      enabled: Boolean(user?.microsoftSync?.enabled),
      lastSyncedAt: user?.microsoftSync?.lastSyncedAt || null,
    });
  } catch (error) {
    console.error("❌ Error fetching Microsoft sync status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/microsoftSync/callback
 *
 * Mirrors routes/googleSyncRoutes.js's /callback exactly -- see that file
 * for the full rationale of embedding the current CMS session JWT in
 * `state` (this attaches a permission to an already-logged-in account, it
 * isn't itself a login, so the browser carries no CMS auth header here).
 * Unlike Google, Microsoft only has this one flow (no separate lightweight
 * one-off "Select" button) -- connecting also runs an immediate first sync
 * below, so there's no need for a second flow just to get an initial batch.
 */
router.get("/callback", async (req, res) => {
  const { code, state, error: msError } = req.query;
  const redirectToApp = (params) => {
    const url = new URL(WEB_MICROSOFT_SYNC_CALLBACK_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    res.redirect(url.toString());
  };

  if (msError) return redirectToApp({ error: "Microsoft sign-in was cancelled or denied." });
  if (!code || !state) return redirectToApp({ error: "Missing Microsoft authorization code." });

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    const payload = jwt.verify(decoded.token, JWT_SECRET);
    userId = payload.userId;
  } catch {
    return redirectToApp({ error: "Microsoft sign-in could not be verified. Please try again." });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      return redirectToApp({ error: "Microsoft didn't grant offline access. Please try again." });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { "microsoftSync.enabled": true, "microsoftSync.refreshToken": tokens.refresh_token } },
      { new: true }
    );
    if (!user) return redirectToApp({ error: "User not found." });

    await syncUserMicrosoftContacts(user);
    redirectToApp({ microsoftSync: "connected" });
  } catch (error) {
    console.error("❌ Error connecting Microsoft sync:", error);
    redirectToApp({ error: "Server error connecting Microsoft sync." });
  }
});

/**
 * POST /api/microsoftSync/disable
 */
router.post("/disable", verifyToken, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user.userId },
      { $set: { "microsoftSync.enabled": false, "microsoftSync.refreshToken": null } }
    );
    res.json({ message: "Microsoft sync disconnected" });
  } catch (error) {
    console.error("❌ Error disabling Microsoft sync:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
