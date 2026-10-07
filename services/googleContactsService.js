// services/googleContactsService.js
import dotenv from "dotenv";
import User from "../models/userModel.js";
import { stageNewPendingContacts } from "./pendingContactsService.js";
dotenv.config();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_SYNC_REDIRECT_URI = process.env.GOOGLE_SYNC_REDIRECT_URI;
const MAX_CONTACTS = 1000;

export async function exchangeCodeForTokens(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: GOOGLE_SYNC_REDIRECT_URI,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Couldn't complete Google sign-in.");
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Couldn't refresh Google access token.");
  }
  return data.access_token;
}

async function fetchGoogleContacts(accessToken) {
  const connections = [];
  let pageToken;

  do {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses,phoneNumbers,organizations",
      pageSize: "200",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || res.statusText);
    }
    const data = await res.json();

    connections.push(...(data.connections || []));
    pageToken = data.nextPageToken;
  } while (pageToken && connections.length < MAX_CONTACTS);

  return connections;
}

function pickByType(entries, type) {
  if (!entries?.length) return "";
  return (entries.find((e) => e.type === type) || entries[0]).value || "";
}

function pickOther(entries, usedValue) {
  if (!entries?.length) return "";
  const other = entries.find((e) => e.value !== usedValue);
  return other ? other.value : entries[0].value || "";
}

// Kept in sync by hand with the frontend's identical mapper
// (src/utils/googleContacts.js) -- separate deployables, no shared package.
function mapGoogleContact(person) {
  const name = person.names?.[0];
  const fname = name?.givenName?.trim();
  const lname = name?.familyName?.trim();
  if (!fname && !lname) return null;

  const org = person.organizations?.[0];
  const emails = person.emailAddresses;
  const phones = person.phoneNumbers;

  const workEmail = pickByType(emails, "work");
  const personalEmail = pickOther(emails, workEmail) || workEmail;
  const workPhone = pickByType(phones, "work");
  const personalPhone = pickOther(phones, workPhone) || workPhone;

  const email = workEmail || personalEmail;
  const emailDomain = email?.split("@")[1];
  const company = org?.name?.trim() || emailDomain || "Personal Contact";

  return {
    fname: fname || "",
    lname: lname || "",
    workInfo: { company, designation: org?.title?.trim() || "", email: workEmail, phone: workPhone },
    personalInfo: { email: personalEmail, phone: personalPhone },
  };
}

// Refreshes this user's Google access token, fetches their current contacts,
// and stages anything new into PendingSyncContacts -- never uploads on its
// own (the user still reviews and picks what to upload). Also used directly
// by the manual one-off "Select" button on Integration.jsx (via
// stagePendingContacts below), not just the daily background sync.
export async function syncUserGoogleContacts(user) {
  const refreshToken = user.googleSync?.refreshToken;
  if (!refreshToken) throw new Error("Google sync is not connected for this user.");

  const accessToken = await refreshAccessToken(refreshToken);
  const connections = await fetchGoogleContacts(accessToken);
  const mapped = connections.map(mapGoogleContact).filter(Boolean);

  const result = await stageNewPendingContacts(user._id, mapped, "google");
  await User.updateOne({ _id: user._id }, { $set: { "googleSync.lastSyncedAt": new Date() } });

  return result;
}

// Used by the manual one-off "Select" flow: the browser already fetched and
// mapped the contacts itself (via a lightweight implicit access token, no
// stored refresh token needed) -- this just stages them the same way.
export async function stagePendingGoogleContacts(userId, mappedContacts) {
  return stageNewPendingContacts(userId, mappedContacts, "google");
}
