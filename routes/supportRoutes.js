import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import SupportMessage from "../models/supportMessageModel.js";
import { sendContactUsNotification } from "../services/mailService.js";

dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * SUBMIT A CONTACT/SUPPORT MESSAGE
 * Public endpoint (no login required) so a user can reach out before or
 * after signing in. If a valid auth token is present, the message is
 * tagged with the logged-in user's id; otherwise it's stored anonymously.
 */
router.post("/contact", async (req, res) => {
  try {
    const { email, message } = req.body;

    if (!email?.trim()) return res.status(400).json({ error: "Email is required" });
    if (!message?.trim()) return res.status(400).json({ error: "Message is required" });

    let userId = null;
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch (err) {
        // Invalid/expired token -- still accept the message anonymously.
      }
    }

    const savedMessage = await new SupportMessage({ email, message, userId }).save();

    // Fire-and-forget -- never blocks/fails the response, since the message
    // is already safely saved above.
    sendContactUsNotification({ fromEmail: email, message });

    res.status(201).json({
      message: "Message submitted successfully!",
      supportMessageId: savedMessage._id,
    });

  } catch (error) {
    console.error("❌ Error submitting contact message:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
