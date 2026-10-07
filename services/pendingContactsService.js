// services/pendingContactsService.js
// Provider-agnostic dedupe/staging logic shared by every contact-sync source
// (services/googleContactsService.js, services/microsoftContactsService.js).
import UploadedContacts from "../models/uploadedContactsModel.js";
import PendingSyncContacts from "../models/pendingSyncContactsModel.js";

function contactKey(c) {
  const fname = (c.fname || "").trim().toLowerCase();
  const lname = (c.lname || "").trim().toLowerCase();
  const phone = ((c.personalInfo?.phone || c.workInfo?.phone) || "").trim();
  const email = ((c.personalInfo?.email || c.workInfo?.email) || "").trim().toLowerCase();
  return `${fname}|${lname}|${phone}|${email}`;
}

// Drops anything the user already has (uploaded, or already sitting in
// PendingSyncContacts from ANY source) and pushes the rest into
// PendingSyncContacts, tagged with `source`, for review. Shared by the daily
// background sync AND the manual one-off "Select" button on Integration.jsx.
export async function stageNewPendingContacts(userId, mappedContacts, source) {
  const [uploads, pendingDoc] = await Promise.all([
    UploadedContacts.find({ userId }),
    PendingSyncContacts.findOne({ userId }),
  ]);

  const existingKeys = new Set();
  uploads.forEach((upload) => upload.contacts.forEach((c) => existingKeys.add(contactKey(c))));
  (pendingDoc?.contacts || []).forEach((c) => existingKeys.add(contactKey(c)));

  const newContacts = mappedContacts
    .filter((c) => !existingKeys.has(contactKey(c)))
    .map((c) => ({ ...c, source }));

  if (newContacts.length > 0) {
    await PendingSyncContacts.findOneAndUpdate(
      { userId },
      { $push: { contacts: { $each: newContacts } } },
      { upsert: true }
    );
  }

  return { found: mappedContacts.length, staged: newContacts.length };
}
