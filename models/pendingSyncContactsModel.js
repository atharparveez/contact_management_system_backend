import mongoose from "mongoose";

const pendingContactSchema = new mongoose.Schema({
  fname: String,
  mname: String,
  lname: String,
  // Which provider found this contact -- per-contact rather than per-document
  // since a user can connect more than one sync source at once.
  source: { type: String, enum: ["google", "microsoft"] },
  addedAt: { type: Date, default: Date.now },
  personalInfo: {
    email: String,
    phone: String,
  },
  workInfo: {
    company: String,
    designation: String,
    phone: String,
    email: String,
  },
});

const pendingSyncContactsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    contacts: [pendingContactSchema],
  },
  { timestamps: true }
);

export default mongoose.model("PendingSyncContacts", pendingSyncContactsSchema, "pendingSyncContacts");
