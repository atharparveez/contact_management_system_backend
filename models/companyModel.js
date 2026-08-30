import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema({
  name: String,
  designation: String,
  email: String,
  contactNumber: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" } 
});

const companySchema = new mongoose.Schema({
  companyName: String,
  category: String,
  categoryName: String,
  website: String,
  city: String,
  state: String,
  country: String,
  employees: [employeeSchema]
});

// ⚠️ Force collection name to match your DB
export default mongoose.model("Company", companySchema, "companyDetails");
