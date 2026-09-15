import express from "express";
import mongoose from "mongoose";
import PurchasedContacts from "../models/purchasedContactsModel.js";
import CreditTransactions from "../models/creditTransactions.js";
import UploadedContacts from "../models/uploadedContactsModel.js";
import Company from "../models/companyModel.js";
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

    // employeeRecordId is the Company.employees subdocument's own _id --
    // always present (even for directory data that was never uploaded
    // through the app), so it's what identifies which search result is
    // being bought.
    const { employeeRecordId } = req.body;

    if (!employeeRecordId) {
      return res.status(400).json({
        success: false,
        message: "employeeRecordId is required"
      });
    }

    // --------------------------------------------------------
    // 0️⃣ Already purchased? Don't charge credits twice.
    // --------------------------------------------------------
    const alreadyPurchased = await PurchasedContacts.findOne({
      userId,
      "contacts.employeeRecordId": employeeRecordId
    });
    if (alreadyPurchased) {
      if (session) {
        await session.commitTransaction();
        session.endSession();
      }
      return res.status(200).json({
        success: true,
        alreadyPurchased: true,
        message: "Contact already purchased"
      });
    }

    // --------------------------------------------------------
    // 1️⃣ Find the employee record being bought
    // --------------------------------------------------------
    const company = await Company.findOne({ "employees._id": employeeRecordId });
    const employee = company?.employees.id(employeeRecordId);

    if (!employee) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      return res.status(404).json({
        success: false,
        message: "Contact not found"
      });
    }

    // --------------------------------------------------------
    // 2️⃣ Look up the full contact from the uploader's own record, if this
    // employee was actually uploaded through the app (has originalContactId).
    // Most employee records are directory data with no such source -- for
    // those, fall back to whatever's on the employee record itself; there's
    // nothing more stored for them.
    // --------------------------------------------------------
    let sourceContact = null;
    if (employee.originalContactId && employee.userId) {
      const uploadDoc = await UploadedContacts.findOne(
        { userId: employee.userId, "contacts.originalContactId": employee.originalContactId },
        { "contacts.$": 1 }
      );
      sourceContact = uploadDoc?.contacts?.[0] || null;
    }

    const now = new Date();

    // --------------------------------------------------------
    // 3️⃣ CREATE CREDIT TRANSACTION
    // --------------------------------------------------------
    await CreditTransactions.create(
      [
        {
          userId,
          action: "purchase",
          points: -5,
          metadata: {
            count: 1,
            contactIds: [employeeRecordId]
          }
        }
      ],
      session ? { session } : {}
    );

    // --------------------------------------------------------
    // 4️⃣ STORE PURCHASED CONTACT
    // --------------------------------------------------------
    const nameParts = (employee.name || "").trim().split(/\s+/).filter(Boolean);

    const purchasedContact = sourceContact
      ? {
          fname: sourceContact.fname,
          mname: sourceContact.mname,
          lname: sourceContact.lname,
          profilePicUrl: sourceContact.profilePicUrl,
          personalInfo: sourceContact.personalInfo,
          workInfo: sourceContact.workInfo
        }
      : {
          fname: nameParts[0] || "",
          mname: nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "",
          lname: nameParts.length > 1 ? nameParts[nameParts.length - 1] : "",
          profilePicUrl: "",
          personalInfo: {},
          workInfo: {
            company: company.companyName,
            designation: employee.designation,
            email: employee.email,
            phone: employee.contactNumber
          }
        };

    Object.assign(purchasedContact, {
      employeeRecordId,
      originalContactId: employee.originalContactId || undefined,

      isPurchased: true,
      isDeleted: false,
      uploadedAt: now,

      action: "purchase",
      credits: -5
    });

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
    // 4️⃣ COMMIT TRANSACTION (if enabled)
    // --------------------------------------------------------
    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Contact purchased successfully",
      contact: purchasedContact
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
