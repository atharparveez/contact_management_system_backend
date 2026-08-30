import mongoose from "mongoose";

const contactSchema = new mongoose.Schema({
  fname: String,
  mname: String,
  lname: String,
  profilePicUrl: String,
  isDeleted: Boolean,
  uploadedAt: Date,
  originalContactId: String,
  action: { type: String, default: "upload" }, 
  credits: { type: Number, default: 5 },       
  personalInfo: {
    email: String,
    phone: String,
    country: String,
    university: String,
    lastDesignation: String,
    lastCompany: String,
    yearFrom: String,
    yearTo: String,
    degree: String
  },
  workInfo: {
    company: String,
    designation: String,
    experience: String,
    phone: String,
    landline: String,
    email: String,
    skills: String,
    city: String,
    state: String,
    country: String,
    pinCode: String
  },
  deletedAt: Date
});

const uploadedContactsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  lastUploaded: Date,
  totalContactsUploaded: Number,
  contacts: [contactSchema],
}, { timestamps: true });

// const UploadedContacts = mongoose.model("UploadedContacts", uploadedContactsSchema,"uploadedContacts");

export default mongoose.model("UploadedContacts", uploadedContactsSchema,"uploadedContacts");
