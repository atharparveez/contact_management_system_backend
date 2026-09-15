import mongoose from "mongoose";

// ✅ A message submitted through the app's "Contact Us" screen
const supportMessageSchema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    message: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true } // Automatically adds createdAt & updatedAt
);

// ✅ Export model (force collection name: "supportMessages")
export default mongoose.model("SupportMessage", supportMessageSchema, "supportMessages");
