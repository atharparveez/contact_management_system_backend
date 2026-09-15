import express from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import User from "../models/userModel.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { uploadSingleProfilePic } from "../middleware/uploadMiddleware.js";
import { buildSpacesPublicUrl } from "../services/s3Service.js";

dotenv.config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;
const APP_OAUTH_CALLBACK_SCHEME = process.env.APP_OAUTH_CALLBACK_SCHEME;

const googleClient = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);

function issueSessionToken(user) {
  return jwt.sign(
    { userId: user._id, email: user.personalInfo?.email },
    JWT_SECRET,
    { expiresIn: "365d" }
  );
}

function loginResponsePayload(user, token) {
  return {
    message: "Login successful!",
    token,
    userId: user._id,
    fname: user.fname,
    lname: user.lname,
    email: user.personalInfo?.email,
    profilePicUrl: user.profilePicUrl,
  };
}

/**
 * Finds an existing user by provider id, else links an existing local
 * account with the same email, else creates a brand-new minimal account.
 */
async function findOrCreateSocialUser({ providerIdField, providerId, email, fname, lname }) {
  let user = await User.findOne({ [providerIdField]: providerId });
  if (user) return user;

  if (email) {
    user = await User.findOne({
      $or: [{ "workInfo.email": email }, { "personalInfo.email": email }],
    });
    if (user) {
      user[providerIdField] = providerId;
      await user.save();
      return user;
    }
  }

  user = new User({
    fname: fname || "New",
    lname: lname || "User",
    authProvider: providerIdField === "googleId" ? "google" : "linkedin",
    [providerIdField]: providerId,
    profileCompleted: false,
    workInfo: { email },
    personalInfo: { email },
  });
  await user.save();
  return user;
}

/**
 * Fields required for a "full" profile, shared by /register and
 * /completeProfile (which skips the password/name checks below).
 */
function missingProfileFields(workInfo, personalInfo) {
  const missingFields = [];
  if (!workInfo.email?.trim()) missingFields.push("Work email");
  if (!workInfo.designation?.trim()) missingFields.push("Designation");
  if (!workInfo.experience?.trim()) missingFields.push("Experience");
  if (!workInfo.company?.trim()) missingFields.push("Company name");
  if (!workInfo.country?.trim()) missingFields.push("Work country");
  if (!personalInfo.email?.trim()) missingFields.push("Personal email");
  return missingFields;
}

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
    missingFields.push(...missingProfileFields(workInfo, personalInfo));

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

    if (!user.password) {
      const provider = user.authProvider === "linkedin" ? "LinkedIn" : "Google";
      return res.status(401).json({
        error: `This account signs in with ${provider}. Please use the "Continue with ${provider}" button instead.`,
      });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid)
      return res.status(401).json({ error: "Invalid password." });

    const token = issueSessionToken(user);
    res.json(loginResponsePayload(user, token));

  } catch (error) {
    console.error("❌ Error logging in:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * LOGIN / SIGN-UP VIA GOOGLE
 */
router.post("/login/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken?.trim()) {
      return res.status(400).json({ error: "Missing Google idToken." });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_WEB_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired Google token." });
    }

    const user = await findOrCreateSocialUser({
      providerIdField: "googleId",
      providerId: payload.sub,
      email: payload.email,
      fname: payload.given_name,
      lname: payload.family_name,
    });

    const token = issueSessionToken(user);
    res.json(loginResponsePayload(user, token));

  } catch (error) {
    console.error("❌ Error logging in with Google:", error);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * LinkedIn's authorization server redirects the in-app browser here (this
 * URL is registered directly with LinkedIn -- it does NOT accept custom app
 * schemes, only http(s)). This route finishes the exchange server-side (the
 * client secret never leaves the backend) and then hands off to the app by
 * redirecting the browser one more time, to APP_OAUTH_CALLBACK_SCHEME --
 * which is what the app's in-app browser (flutter_web_auth_2) is actually
 * watching for. `state` is round-tripped untouched so the app can verify it
 * matches what it generated (CSRF protection), since the backend itself
 * didn't originate the request.
 */
router.get("/login/linkedin/callback", async (req, res) => {
  const { code, state, error: linkedinError } = req.query;

  const redirectToApp = (params) => {
    const query = new URLSearchParams(params).toString();
    res.redirect(`${APP_OAUTH_CALLBACK_SCHEME}?${query}`);
  };

  if (linkedinError) {
    return redirectToApp({ error: "LinkedIn sign-in was cancelled or denied.", state: state || "" });
  }
  if (!code) {
    return redirectToApp({ error: "Missing LinkedIn authorization code.", state: state || "" });
  }

  try {
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      return redirectToApp({ error: "Invalid or expired LinkedIn code.", state: state || "" });
    }

    const profileResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) {
      return redirectToApp({ error: "Could not fetch LinkedIn profile.", state: state || "" });
    }
    const profile = await profileResponse.json();

    const user = await findOrCreateSocialUser({
      providerIdField: "linkedinId",
      providerId: profile.sub,
      email: profile.email,
      fname: profile.given_name,
      lname: profile.family_name,
    });

    const token = issueSessionToken(user);
    redirectToApp({
      token,
      userId: user._id.toString(),
      fname: user.fname,
      lname: user.lname,
      email: user.personalInfo?.email || "",
      state: state || "",
    });

  } catch (error) {
    console.error("❌ Error logging in with LinkedIn:", error);
    redirectToApp({ error: "Server error signing in with LinkedIn.", state: state || "" });
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

/**
 * COMPLETE PROFILE (for social-login accounts filling in the rest of their
 * details for the first time; supports profile pic upload). Unlike
 * /updateUser, this enforces the same required fields as /register (minus
 * password) and always marks the account's profile as completed on success.
 */
router.put("/completeProfile", verifyToken, uploadSingleProfilePic, async (req, res) => {
  try {
    const userId = req.user.userId;
    const data = req.body;

    const workInfo = typeof data.workInfo === "string" ? JSON.parse(data.workInfo) : (data.workInfo || {});
    const personalInfo = typeof data.personalInfo === "string" ? JSON.parse(data.personalInfo) : (data.personalInfo || {});

    const missingFields = missingProfileFields(workInfo, personalInfo);
    if (missingFields.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(", ")}` });
    }

    const updates = { workInfo, personalInfo, profileCompleted: true };
    if (data.fname?.trim()) updates.fname = data.fname;
    if (data.mname !== undefined) updates.mname = data.mname;
    if (data.lname?.trim()) updates.lname = data.lname;
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
      message: "Profile completed successfully!",
      user: updatedUser,
      profilePicUrl: updatedUser.profilePicUrl
    });

  } catch (error) {
    console.error("❌ Error completing profile:", error);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
