import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ✅ Define the structure for workInfo and personalInfo
const workInfoSchema = new mongoose.Schema({
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
  pinCode: String,
});

const personalInfoSchema = new mongoose.Schema({
  email: String,
  phone: String,
  qualification: String,
  city: String,
  state: String,
  university: String,
  degree: String,
  yearFrom: String,
  yearTo: String,
  lastCompany: String,
  lastDesignation: String,
  country: String,
});

// ✅ Define main user schema
const userSchema = new mongoose.Schema(
  {
    fname: { type: String, required: true },
    mname: { type: String },
    lname: { type: String, required: true },
    // Required only for accounts created with an email/password (local).
    // Google/LinkedIn accounts authenticate via the provider, not a password.
    password: {
      type: String,
      required: function () {
        return this.authProvider === "local";
      },
    },
    profilePicUrl: { type: String },
    workInfo: workInfoSchema,
    personalInfo: personalInfoSchema,
    authProvider: {
      type: String,
      enum: ["local", "google", "linkedin"],
      default: "local",
    },
    googleId: { type: String, index: true, sparse: true, unique: true },
    linkedinId: { type: String, index: true, sparse: true, unique: true },
    // False only for social-login accounts that haven't filled in the rest
    // of their profile (designation, company, etc.) yet.
    profileCompleted: { type: Boolean, default: true },
  },
  { timestamps: true } // Automatically adds createdAt & updatedAt
);

// ✅ Hash the password before saving, only if it changed
userSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

// ✅ Export model (force collection name: "users")
export default mongoose.model("User", userSchema, "users");
