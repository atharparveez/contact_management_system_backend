import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../models/userModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { uploadSingleProfilePic } from "../middleware/uploadMiddleware.js";
import { buildSpacesPublicUrl } from "../services/s3Service.js";

dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * REGISTER USER (supports profile pic upload)
 */
router.post("/register", uploadSingleProfilePic, async (req, res) => {
  try {
    const data = req.body;

    const workInfo = typeof data.workInfo === "string" ? JSON.parse(data.workInfo) : (data.workInfo || {});
    const personalInfo = typeof data.personalInfo === "string" ? JSON.parse(data.personalInfo) : (data.personalInfo || {});

    const missingFields = [];
    if (!data.fname?.trim()) missingFields.push("First name");
    if (!data.lname?.trim()) missingFields.push("Last name");
    if (!data.password?.trim()) missingFields.push("Password");
    if (!workInfo.email?.trim()) missingFields.push("Work email");
    if (!workInfo.designation?.trim()) missingFields.push("Designation");
    if (!workInfo.experience?.trim()) missingFields.push("Experience");
    if (!workInfo.company?.trim()) missingFields.push("Company name");
    if (!workInfo.country?.trim()) missingFields.push("Work country");
    if (!personalInfo.email?.trim()) missingFields.push("Personal email");

    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
    }

    let profilePicUrl = "";
    if (req.file && req.file.bucket && req.file.key) {
      profilePicUrl = buildSpacesPublicUrl(req.file.bucket, req.file.key);
    }

    const newUser = new User({
      fname: data.fname,
      mname: data.mname,
      lname: data.lname,
      password: data.password,
      profilePicUrl: profilePicUrl,
      workInfo,
      personalInfo
    });

    const savedUser = await newUser.save();

    res.status(201).json({
      message: "User registered successfully!",
      userId: savedUser._id,
      profilePicUrl: savedUser.profilePicUrl
    });

  } catch (error) {
    console.error("❌ Error registering user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * LOGIN USER
 */
router.post("/login", async (req, res) => {
  console.log("HEADERS:", req.headers);
  console.log("BODY:", req.body);
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ "workInfo.email": email });
    if (!user) return res.status(404).json({ error: "User not found." });

    const isValid = await user.comparePassword(password);
    if (!isValid)
      return res.status(401).json({ error: "Invalid password." });

    const token = jwt.sign(
      { userId: user._id, email: user.personalInfo.email },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    res.json({
      message: "Login successful!",
      token,
      userId: user._id,
      fname: user.fname,
      lname: user.lname,
      email: user.personalInfo.email,
      profilePicUrl: user.profilePicUrl
    });

  } catch (error) {
    console.error("❌ Error logging in:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET USER DETAILS
 */
router.get("/userDetails", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select("-password");

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (error) {
    console.error("❌ Error fetching user details:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * UPDATE USER DETAILS (supports profile pic upload)
 */
router.put("/updateUser", verifyToken, uploadSingleProfilePic, async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = req.body;

    // Only parse if it's a string
    if (updates.workInfo && typeof updates.workInfo === "string") {
      updates.workInfo = JSON.parse(updates.workInfo);
    }

    if (updates.personalInfo && typeof updates.personalInfo === "string") {
      updates.personalInfo = JSON.parse(updates.personalInfo);
    }

    if (updates.workInfo && !updates.workInfo.company?.trim()) {
      return res.status(400).json({ error: "Work company is required" });
    }

    if (req.file && req.file.bucket && req.file.key) {
      updates.profilePicUrl = buildSpacesPublicUrl(req.file.bucket, req.file.key);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true }
    ).select("-password");

    if (!updatedUser) return res.status(404).json({ error: "User not found." });

    res.json({
      message: "User details updated successfully!",
      user: updatedUser,
      profilePicUrl: updatedUser.profilePicUrl
    });

  } catch (error) {
    console.error("❌ Error updating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
