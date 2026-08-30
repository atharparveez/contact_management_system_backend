import express from "express";
import mongoose from "mongoose";
import PurchasedContacts from "../models/purchasedContactsModel.js";
import CreditTransactions from "../models/creditTransactions.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// ✅ ENV flag
const TRANSACTIONS_ENABLED = process.env.MONGO_TRANSACTIONS === "true";

/**
 * ============================================================
 * POST /api/contacts/purchase
 * Deduct credits + save purchased contact
 * ============================================================
 */
router.post("/purchase", verifyToken, async (req, res) => {
  let session = null;

  try {
    // --------------------------------------------------------
    // 0️⃣ Start transaction ONLY if enabled
    // --------------------------------------------------------
    if (TRANSACTIONS_ENABLED) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    // ✅ userId from JWT
    const userId = req.user.userId;

    const {
      fname,
      mname,
      lname,
      profilePicUrl,
      originalContactId,
      personalInfo,
      workInfo
    } = req.body;

    if (!originalContactId) {
      return res.status(400).json({
        success: false,
        message: "originalContactId is required"
      });
    }

    const now = new Date();

    // --------------------------------------------------------
    // 1️⃣ CREATE CREDIT TRANSACTION
    // --------------------------------------------------------
    await CreditTransactions.create(
      [
        {
          userId,
          action: "purchase",
          points: -5,
          metadata: {
            count: 1,
            contactIds: [originalContactId]
          }
        }
      ],
      session ? { session } : {}
    );

    // --------------------------------------------------------
    // 2️⃣ STORE PURCHASED CONTACT
    // --------------------------------------------------------
    const purchasedContact = {
      fname,
      mname,
      lname,
      profilePicUrl,
      originalContactId,

      isPurchased: true,
      isDeleted: false,
      uploadedAt: now,

      action: "purchase",
      credits: -5,

      personalInfo,
      workInfo
    };

    await PurchasedContacts.findOneAndUpdate(
      { userId },
      { $push: { contacts: purchasedContact } },
      {
        upsert: true,
        new: true,
        ...(session && { session })
      }
    );

    // --------------------------------------------------------
    // 3️⃣ COMMIT TRANSACTION (if enabled)
    // --------------------------------------------------------
    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Contact purchased successfully"
    });

  } catch (error) {
    // --------------------------------------------------------
    // ❌ ROLLBACK (if enabled)
    // --------------------------------------------------------
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }

    console.error("❌ Purchase failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to purchase contact"
    });
  }
});

/**
 * ============================================================
 * GET /api/contacts/purchased
 * Get all purchased contacts for logged-in user
 * ============================================================
 */
router.get("/purchased", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Invalid user"
      });
    }

    const objectId = new mongoose.Types.ObjectId(userId);

    const purchasedData = await PurchasedContacts.findOne({ userId: objectId })
      .select("contacts -_id")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      contacts: purchasedData?.contacts || []
    });

  } catch (error) {
    console.error("❌ Error fetching purchased contacts:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

export default router;
