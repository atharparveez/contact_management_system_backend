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
    password: { type: String, required: true },
    profilePicUrl: { type: String },
    workInfo: workInfoSchema,
    personalInfo: personalInfoSchema,
  },
  { timestamps: true } // Automatically adds createdAt & updatedAt
);

// ✅ Hash the password before saving, only if it changed
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ✅ Export model (force collection name: "users")
export default mongoose.model("User", userSchema, "users");
