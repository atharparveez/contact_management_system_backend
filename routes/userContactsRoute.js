import express from "express";
import UserContacts from "../models/userContactsModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { uploadSingleProfilePic } from "../middleware/uploadMiddleware.js";

const router = express.Router();

/**
 * Save or update user’s device contacts
 * Body: { contacts: [...] }
 */
router.post("/sync", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({ error: "Contacts must be an array." });
    }

    // One record per user; create it on first sync.
    let existing = await UserContacts.findOne({ userId });
    if (!existing) {
      existing = new UserContacts({ userId, contacts: [] });
    }

    // Upsert each incoming contact by originalContactId (the phone's stable
    // contact id) so an edit to one contact updates that subdocument in
    // place -- keeping its _id/createdAt -- instead of the whole array
    // being torn down and rebuilt on every sync.
    for (const incoming of contacts) {
      const { originalContactId } = incoming;
      const match = originalContactId
        ? existing.contacts.find((c) => c.originalContactId === originalContactId)
        : undefined;

      if (match) {
        match.set({
          fname: incoming.fname,
          mname: incoming.mname,
          lname: incoming.lname,
          profilePicUrl: incoming.profilePicUrl,
          workInfo: incoming.workInfo,
          personalInfo: incoming.personalInfo,
          syncedAt: new Date(),
        });
      } else {
        existing.contacts.push({
          ...incoming,
          syncedAt: new Date(),
        });
      }
    }

    existing.lastSynced = new Date();
    await existing.save();

    res.json({
      message: "Contacts synced successfully",
      data: existing
    });

  } catch (error) {
    console.error("❌ Error saving contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Fetch user’s synced contacts
 */
router.get("/list", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const data = await UserContacts.findOne({ userId }).lean();

    res.json({
      id: data?._id,                // <--- ADD THIS
      contacts: data?.contacts || [],
      lastSynced: data?.lastSynced || null
    });

  } catch (error) {
    console.error("❌ Error fetching contacts:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// Helper function to convert nested object to dot notation
function flattenObject(obj, prefix = "") {
  let result = {};
  for (const key in obj) {
    if (obj[key] && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
      Object.assign(result, flattenObject(obj[key], prefix + key + "."));
    } else {
      result[prefix + key] = obj[key];
    }
  }
  return result;
}

// PUT /api/userContacts/:userId/contacts/:contactId
router.put("/:userId/contacts/:contactId", verifyToken, uploadSingleProfilePic, async (req, res) => {
  const userId = req.params.userId;
  const contactId = req.params.contactId;
  const updateData = req.body;

  let workInfoForValidation = updateData.workInfo;
  if (typeof workInfoForValidation === "string") {
    try {
      workInfoForValidation = JSON.parse(workInfoForValidation);
    } catch (e) {
      workInfoForValidation = null;
    }
  }
  if (workInfoForValidation && !workInfoForValidation.company?.trim()) {
    return res.status(400).json({ success: false, message: "Work company is required" });
  }

  try {
    // If a file was uploaded, store the URL in updateData
    if (req.file && req.file.location) {
      updateData.profilePicUrl = req.file.location; // <-- S3 URL
      console.log("Uploaded profile pic URL:", req.file.location);
    }

    // Flatten nested objects for MongoDB dot notation
    const updateObj = flattenObject(updateData);

    const mongoUpdate = {};
    for (const key in updateObj) {
      mongoUpdate[`contacts.$[elem].${key}`] = updateObj[key];
    }

    const result = await UserContacts.updateOne(
      { _id: userId },
      { $set: mongoUpdate },
      { arrayFilters: [{ "elem._id": contactId }] }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, message: "Contact not found or nothing updated" });
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});




export default router;
