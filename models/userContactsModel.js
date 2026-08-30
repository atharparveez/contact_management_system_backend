import mongoose from "mongoose";

const WorkInfoSchema = new mongoose.Schema({
  email: String,
  phone: String,
  landline: String,
  company: String,
  designation: String,
  experience: String,
  skills: String,
  city: String,
  state: String,
  country: String,
  pinCode: String
}, { timestamps: true });

const PersonalInfoSchema = new mongoose.Schema({
  email: String,
  phone: String,
  university: String,
  degree: String,
  yearFrom: String,
  yearTo: String,
  lastCompany: String,
  lastDesignation: String,
  country: String
}, { timestamps: true });

const ContactSchema = new mongoose.Schema({
  originalContactId: String,
  fname: String,
  mname: String,
  lname: String,
  profilePicUrl: String,
  syncedAt: Date,
  workInfo: WorkInfoSchema,
  personalInfo: PersonalInfoSchema
}, { timestamps: true });

const UserContactsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  contacts: [ContactSchema],
  lastSynced: { type: Date, default: new Date() }
});

export default mongoose.model("UserContacts",UserContactsSchema,"userContacts");
