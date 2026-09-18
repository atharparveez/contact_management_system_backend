// routes/uploadContactsRoute.js

import express from "express";
import mongoose from "mongoose";
import UploadedContacts from "../models/uploadedContactsModel.js";
import Company from "../models/companyModel.js";
import CreditTransactions from "../models/creditTransactions.js";
import User from "../models/userModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ============================================================
 *  POST /api/contacts/upload
 *  Upload contacts + detect existing companies
 * ============================================================
 */
router.post("/upload", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) return res.status(400).json({ message: "Invalid user" });

    const { contacts, creditPayload } = req.body;
    // creditPayload = the payload sent from frontend

    if (!contacts || !Array.isArray(contacts))
      return res.status(400).json({ message: "Contacts must be an array" });

    // -----------------------------------------------------------
    // 1️⃣ STRICT DUPLICATE CHECK USING fname + lname + phone + email
    // -----------------------------------------------------------
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const previousUploads = await UploadedContacts.find({ userId: userObjectId });
    let existingContacts = [];
    previousUploads.forEach(upload => {
      upload.contacts.forEach(c => {
        existingContacts.push({
          fname: (c.fname || "").trim().toLowerCase(),
          lname: (c.lname || "").trim().toLowerCase(),
          phone: ((c.personalInfo?.phone || c.workInfo?.phone) || "").trim(),
          email: ((c.personalInfo?.email || c.workInfo?.email) || "").trim().toLowerCase()
        });
      });
    });

    const duplicates = contacts.filter(c => {
      const fname = (c.fname || "").trim().toLowerCase();
      const lname = (c.lname || "").trim().toLowerCase();
      const phone = ((c.personalInfo?.phone || c.workInfo?.phone) || "").trim();
      const email = ((c.personalInfo?.email || c.workInfo?.email) || "").trim().toLowerCase();

      return existingContacts.some(ex =>
        ex.fname === fname &&
        ex.lname === lname &&
        ex.phone === phone &&
        ex.email === email
      );
    });

    if (duplicates.length > 0) {
      return res.status(200).json({
        error: true,
        message: "Some contacts were already uploaded",
        duplicates: duplicates.map(c => ({
          fname: c.fname,
          lname: c.lname,
          phone: c.personalInfo?.phone || c.workInfo?.phone,
          email: c.personalInfo?.email || c.workInfo?.email
        }))
      });
    }

    // -----------------------------------------------------------
    // 2️⃣ Work company is mandatory for every contact being uploaded
    // -----------------------------------------------------------
    const missingCompany = contacts.filter(c => !c.workInfo?.company?.trim());
    if (missingCompany.length > 0) {
      return res.status(400).json({
        error: true,
        message: "Work company is required for all contacts",
        missingCompany: missingCompany.map(c => ({
          fname: c.fname,
          lname: c.lname
        }))
      });
    }

    // -----------------------------------------------------------
    // 3️⃣ Extract unique company names
    // -----------------------------------------------------------
    const companiesInUpload = [
      ...new Set(
        contacts.map(c => c.workInfo.company.trim())
      )
    ];

    console.log("🔍 Companies in upload:", companiesInUpload);

    // -----------------------------------------------------------
    // 4️⃣ Find existing companies (case-insensitive)
    // -----------------------------------------------------------
    const existingCompanies = await Company.find({
      companyName: {
        $in: companiesInUpload.map(name => new RegExp(`^${escapeRegex(name)}$`, "i"))
      }
    });

    // normalized (lowercase) name -> canonical companyName already stored in DB
    const existingNameMap = new Map(
      existingCompanies.map(c => [c.companyName.trim().toLowerCase(), c.companyName])
    );
    console.log("📌 Existing companies:", [...existingNameMap.values()]);

    // -----------------------------------------------------------
    // 5️⃣ Group contacts by company (case-insensitive)
    // -----------------------------------------------------------
    const groupedByCompany = {};
    contacts.forEach(contact => {
      const rawCompanyName = contact.workInfo.company.trim();
      const normalized = rawCompanyName.toLowerCase();
      if (!groupedByCompany[normalized]) {
        groupedByCompany[normalized] = {
          canonicalName: existingNameMap.get(normalized) || rawCompanyName,
          contacts: []
        };
      }
      groupedByCompany[normalized].contacts.push(contact);
    });

    // -----------------------------------------------------------
    // 6️⃣ Process new & existing companies
    // -----------------------------------------------------------
    for (const normalized of Object.keys(groupedByCompany)) {
      const { canonicalName, contacts: employeesForCompany } = groupedByCompany[normalized];

      const employeeDocs = employeesForCompany.map(c => ({
        name: `${c.fname ?? ""} ${c.mname ?? ""} ${c.lname ?? ""}`.trim(),
        designation: c.workInfo?.designation || "",
        email: c.workInfo?.email || "",
        contactNumber: c.workInfo?.phone || "",
        originalContactId: c.originalContactId || "",
        userId
      }));

      if (existingNameMap.has(normalized)) {
        console.log(`➡️ Appending employees to existing company: ${canonicalName}`);

        await Company.updateOne(
          { companyName: canonicalName },
          { $push: { employees: { $each: employeeDocs } } }
        );

      } else {
        console.log(`🆕 Creating new company document: ${canonicalName}`);

        const firstContact = employeesForCompany[0];

        await Company.create({
          companyName: canonicalName,
          category: firstContact.workInfo?.category || "",
          categoryName: firstContact.workInfo?.categoryName || "",
          website: firstContact.workInfo?.website || "",
          city: firstContact.workInfo?.city || "",
          state: firstContact.workInfo?.state || "",
          country: firstContact.workInfo?.country || "",
          userId,
          employees: employeeDocs
        });
      }
    }

    // -----------------------------------------------------------
    // 7️⃣ Save uploaded contacts
    // -----------------------------------------------------------
    const processedContacts = contacts.map(contact => ({
      ...contact,
      action: contact.action || "upload",
      credits: contact.credits ?? 5,
      uploadedAt: new Date(),
      deletedAt: contact.isDeleted ? new Date() : null
    }));

    // Upsert into this user's single UploadedContacts document instead of
    // creating a new one per upload call, so repeated uploads accumulate
    // into one record (mirroring how userContacts/purchasedContacts work).
    const savedUpload = await UploadedContacts.findOneAndUpdate(
      { userId: userObjectId },
      {
        $push: { contacts: { $each: processedContacts } },
        $set: { lastUploaded: new Date() },
        $inc: { totalContactsUploaded: processedContacts.length }
      },
      { upsert: true, new: true }
    );

    console.log("✅ Upload saved:", savedUpload._id);

    // -----------------------------------------------------------
    // 8️⃣ NEW: Save credit transaction
    // -----------------------------------------------------------
    if (creditPayload) {
      console.log("📦 Saving credit transaction:", creditPayload);

      await CreditTransactions.create({
        userId: userObjectId,
        action: creditPayload.action,
        points: creditPayload.points,
        metadata: creditPayload.metadata || {},
        createdAt: new Date()
      });

      console.log("💰 Credit transaction saved");
    }

    // -----------------------------------------------------------

    res.status(201).json({
      message: "Contacts uploaded successfully",
      data: savedUpload,
      checkedCompanies: [...existingNameMap.values()]
    });

  } catch (error) {
    console.error("❌ Error uploading contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// ===================== NEW CODE (added for web "My Contacts" tab) =====================
// Populates a user's "My Contacts" list by matching contact records — uploaded by ANYONE —
// against this user's own registered email addresses (workInfo.email / personalInfo.email).
// The web app has no device-contacts concept to sync from (unlike the mobile app), so this
// endpoint is a web-specific substitute data source for that tab. This is new server-side
// logic; review before merging.
/**
 * ============================================================
 *  GET /api/contacts/linkedByEmail
 *  Fetch contacts (uploaded by anyone) whose email matches
 *  the logged-in user's own registered email address(es)
 * ============================================================
 */
router.get("/linkedByEmail", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) return res.status(400).json({ message: "Invalid user" });

    const currentUser = await User.findById(userId).select(
      "workInfo.email personalInfo.email"
    );
    if (!currentUser) return res.status(404).json({ message: "User not found" });

    const emails = [currentUser.workInfo?.email, currentUser.personalInfo?.email]
      .filter(Boolean)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    if (emails.length === 0) {
      return res.status(200).json({ contacts: [] });
    }

    const emailRegexes = emails.map((e) => new RegExp(`^${escapeRegex(e)}$`, "i"));

    const uploads = await UploadedContacts.find({
      $or: [
        { "contacts.personalInfo.email": { $in: emailRegexes } },
        { "contacts.workInfo.email": { $in: emailRegexes } },
      ],
    });

    const matched = [];
    uploads.forEach((upload) => {
      upload.contacts.forEach((c) => {
        const personalEmail = (c.personalInfo?.email || "").trim().toLowerCase();
        const workEmail = (c.workInfo?.email || "").trim().toLowerCase();
        if (emails.includes(personalEmail) || emails.includes(workEmail)) {
          matched.push(c);
        }
      });
    });

    res.status(200).json({ contacts: matched });
  } catch (error) {
    console.error("❌ Error fetching linked-by-email contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});
// ========================================================================================

/**
 * ============================================================
 *  GET /api/contacts/loadedContacts
 *  Fetch previously uploaded contacts
 * ============================================================
 */
router.get("/loadedContacts", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "Invalid user" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const uploads = await UploadedContacts.find({ userId: userObjectId })
      .sort({ lastUploaded: -1 });

    if (!uploads || uploads.length === 0) {
      return res.status(404).json({
        message: "No uploaded contacts found for this user."
      });
    }

    return res.status(200).json({
      message: "Uploaded contacts fetched successfully",
      data: uploads
    });

  } catch (error) {
    console.error("❌ Error fetching uploaded contacts:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET => Fetches all the credits of a particular user
router.get("/getCredits", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) return res.status(400).json({ message: "Invalid user" });

    // Correct ObjectId usage
    const objectId = new mongoose.Types.ObjectId(userId);

    // Fetch all transactions for this user
    const transactions = await CreditTransactions.find({ userId: objectId })
      .sort({ createdAt: -1 });

    // Calculate total points
    const totalPoints = transactions.reduce((acc, t) => acc + t.points, 0);

    res.status(200).json({ totalPoints, transactions });
  } catch (error) {
    console.error("❌ Error fetching credit transactions:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * ============================================================
 *  GET /api/credits/total
 *  Returns total earned credit points for the logged-in user
 * ============================================================
 */
router.get("/total", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "Invalid user" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const result = await CreditTransactions.aggregate([
      { $match: { userId: userObjectId } },
      {
        $group: {
          _id: null,
          totalPoints: { $sum: "$points" }
        }
      }
    ]);

    const totalPoints = result.length > 0 ? result[0].totalPoints : 0;

    return res.status(200).json({
      userId,
      totalPoints
    });

  } catch (error) {
    console.error("❌ Error fetching credits:", error);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
