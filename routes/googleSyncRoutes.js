// routes/googleSyncRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/userModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { exchangeCodeForTokens, stagePendingGoogleContacts, syncUserGoogleContacts } from "../services/googleContactsService.js";
dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const WEB_GOOGLE_SYNC_CALLBACK_URL = process.env.WEB_GOOGLE_SYNC_CALLBACK_URL;

/**
 * GET /api/googleSync/status
 */
router.get("/status", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("googleSync");
    res.json({
      enabled: Boolean(user?.googleSync?.enabled),
      lastSyncedAt: user?.googleSync?.lastSyncedAt || null,
    });
  } catch (error) {
    console.error("❌ Error fetching Google sync status:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/googleSync/pending/stage
 * body: { contacts: [{ fname, mname, lname, workInfo, personalInfo }] }
 *
 * Used by the one-off manual "Select" button (Integration.jsx), which
 * already has the contacts in hand from the browser's own one-time Google
 * access-token fetch -- this just stages them server-side through the same
 * dedupe logic as the background sync, so the My Contacts pending panel has
 * one single, already-proven-reliable source to read from (GET /contactSync/pending)
 * instead of trying to hand contacts to that page via router state.
 */
router.post("/pending/stage", verifyToken, async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ message: "contacts must be a non-empty array" });
    }
    const result = await stagePendingGoogleContacts(req.user.userId, contacts);
    res.json(result);
  } catch (error) {
    console.error("❌ Error staging pending contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/googleSync/callback
 *
 * Google's redirect target for the offline-access Authorization Code flow
 * (see src/utils/googleSyncOAuth.js on the web side). Unlike a login
 * callback, this attaches an extra permission to an ALREADY-logged-in CMS
 * account, so the browser carries no CMS auth header here -- the web app
 * instead embeds its own current session JWT into `state` before
 * redirecting out, and this route verifies that JWT (same JWT_SECRET/
 * jsonwebtoken already used everywhere else) to recover which user this is,
 * the same "state as a tamper-proof payload channel" idea already used by
 * /login/linkedin/callback in userRoutes.js.
 */
router.get("/callback", async (req, res) => {
  const { code, state, error: googleError } = req.query;
  const redirectToApp = (params) => {
    const url = new URL(WEB_GOOGLE_SYNC_CALLBACK_URL);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    res.redirect(url.toString());
  };

  if (googleError) return redirectToApp({ error: "Google sign-in was cancelled or denied." });
  if (!code || !state) return redirectToApp({ error: "Missing Google authorization code." });

  let userId;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    const payload = jwt.verify(decoded.token, JWT_SECRET);
    userId = payload.userId;
  } catch {
    return redirectToApp({ error: "Google sign-in could not be verified. Please try again." });
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only issues a refresh token on first consent (or when
      // prompt=consent is forced, which the web button already sets) --
      // if it's still missing here, something upstream skipped that.
      return redirectToApp({ error: "Google didn't grant offline access. Please try again." });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { "googleSync.enabled": true, "googleSync.refreshToken": tokens.refresh_token } },
      { new: true }
    );
    if (!user) return redirectToApp({ error: "User not found." });

    await syncUserGoogleContacts(user);
    redirectToApp({ googleSync: "connected" });
  } catch (error) {
    console.error("❌ Error connecting Google sync:", error);
    redirectToApp({ error: "Server error connecting Google sync." });
  }
});

/**
 * POST /api/googleSync/disable
 */
router.post("/disable", verifyToken, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user.userId },
      { $set: { "googleSync.enabled": false, "googleSync.refreshToken": null } }
    );
    res.json({ message: "Google sync disconnected" });
  } catch (error) {
    console.error("❌ Error disabling Google sync:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
