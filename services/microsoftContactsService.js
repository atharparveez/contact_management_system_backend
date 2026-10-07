// services/microsoftContactsService.js
import dotenv from "dotenv";
import User from "../models/userModel.js";
import { stageNewPendingContacts } from "./pendingContactsService.js";
dotenv.config();

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_SYNC_REDIRECT_URI = process.env.MICROSOFT_SYNC_REDIRECT_URI;
const MAX_CONTACTS = 1000;
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: MICROSOFT_SYNC_REDIRECT_URI,
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      scope: "offline_access Contacts.Read",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Couldn't complete Microsoft sign-in.");
  }
  return data; // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: MICROSOFT_CLIENT_ID,
      client_secret: MICROSOFT_CLIENT_SECRET,
      scope: "offline_access Contacts.Read",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Couldn't refresh Microsoft access token.");
  }
  return data.access_token;
}

async function fetchMicrosoftContacts(accessToken) {
  const contacts = [];
  let url =
    "https://graph.microsoft.com/v1.0/me/contacts?" +
    new URLSearchParams({
      $select: "givenName,surname,companyName,jobTitle,emailAddresses,businessPhones,homePhones",
      $top: "200",
    });

  while (url && contacts.length < MAX_CONTACTS) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message || res.statusText);
    }
    const data = await res.json();

    contacts.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }

  return contacts;
}

// Kept in sync by hand with the equivalent Google mapper -- separate
// providers, same output shape our contact model expects.
function mapMicrosoftContact(contact) {
  const fname = contact.givenName?.trim();
  const lname = contact.surname?.trim();
  if (!fname && !lname) return null;

  const workEmail = contact.emailAddresses?.[0]?.address || "";
  const personalEmail = contact.emailAddresses?.[1]?.address || workEmail;
  const workPhone = contact.businessPhones?.[0] || "";
  const personalPhone = contact.homePhones?.[0] || workPhone;

  const email = workEmail || personalEmail;
  const emailDomain = email?.split("@")[1];
  const company = contact.companyName?.trim() || emailDomain || "Personal Contact";

  return {
    fname: fname || "",
    lname: lname || "",
    workInfo: { company, designation: contact.jobTitle?.trim() || "", email: workEmail, phone: workPhone },
    personalInfo: { email: personalEmail, phone: personalPhone },
  };
}

// Refreshes this user's Microsoft access token, fetches their current
// contacts, and stages anything new into PendingSyncContacts -- never
// uploads on its own (the user still reviews and picks what to upload).
export async function syncUserMicrosoftContacts(user) {
  const refreshToken = user.microsoftSync?.refreshToken;
  if (!refreshToken) throw new Error("Microsoft sync is not connected for this user.");

  const accessToken = await refreshAccessToken(refreshToken);
  const contacts = await fetchMicrosoftContacts(accessToken);
  const mapped = contacts.map(mapMicrosoftContact).filter(Boolean);

  const result = await stageNewPendingContacts(user._id, mapped, "microsoft");
  await User.updateOne({ _id: user._id }, { $set: { "microsoftSync.lastSyncedAt": new Date() } });

  return result;
}
