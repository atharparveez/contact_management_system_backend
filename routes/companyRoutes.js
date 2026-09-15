import express from "express";
import Company from "../models/companyModel.js";
import PurchasedContacts from "../models/purchasedContactsModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ✅ API: Search companies by companyName OR employee name (partial match)
 * Example:
 *   GET /api/companies/employees?companyName=Mar
 */
router.get("/employees", verifyToken, async (req, res) => {
  try {
    const { companyName } = req.query;

    if (!companyName) {
      return res.status(400).json({ error: "companyName is required" });
    }

    // 🧠 Case-insensitive, partial match search on companyName or employees.name
    const searchRegex = new RegExp(escapeRegex(companyName), "i");
    const companies = await Company.find({
      $or: [
        { companyName: { $regex: searchRegex } },
        { "employees.name": { $regex: searchRegex } },
      ],
    });

    if (!companies || companies.length === 0) {
      return res.status(404).json({ message: "No matching companies found" });
    }

    // 🧠 Which of this user's already-purchased employeeRecordIds show up in
    // these results, so the app can show "purchased by you" instead of the
    // buy button on a repeat search. employeeRecordId (the Company.employees
    // subdocument's own _id) is used rather than originalContactId because
    // most employee records are directory data that was never uploaded
    // through the app and so has no originalContactId at all.
    const purchasedDoc = await PurchasedContacts.findOne({ userId: req.user.userId })
      .select("contacts.employeeRecordId -_id")
      .lean();
    const purchasedIds = new Set(
      (purchasedDoc?.contacts || [])
        .map((c) => c.employeeRecordId)
        .filter(Boolean)
    );

    // 🧾 Format full company info + employees
    const response = companies.map((company) => ({
      companyName: company.companyName,
      category: company.category,
      website: company.website,
      city: company.city,
      state: company.state,
      country: company.country,
      employees: (company.employees || []).map((employee) => ({
        ...employee.toObject(),
        employeeRecordId: employee._id.toString(),
        purchasedByMe: purchasedIds.has(employee._id.toString()),
      })),
    }));

    res.json(response);
  } catch (err) {
    console.error("Error fetching companies:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;