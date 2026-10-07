// services/contactSyncScheduler.js
import cron from "node-cron";
import User from "../models/userModel.js";
import { syncUserGoogleContacts } from "./googleContactsService.js";
import { syncUserMicrosoftContacts } from "./microsoftContactsService.js";

const PROVIDERS = [
  { key: "google", enabledField: "googleSync.enabled", sync: syncUserGoogleContacts },
  { key: "microsoft", enabledField: "microsoftSync.enabled", sync: syncUserMicrosoftContacts },
];

// Runs once daily at 3am server time, once per connected provider. Each
// enabled user is synced independently so one user's failure (revoked
// access, expired refresh token, etc.) doesn't block anyone else's, and one
// provider failing doesn't block the other.
export function startContactSyncScheduler() {
  cron.schedule("0 3 * * *", async () => {
    for (const provider of PROVIDERS) {
      const users = await User.find({ [provider.enabledField]: true });
      console.log(`🔄 ${provider.key} contacts sync: running for ${users.length} user(s)`);

      for (const user of users) {
        try {
          const result = await provider.sync(user);
          console.log(`✅ ${provider.key} sync for ${user._id}: found ${result.found}, staged ${result.staged}`);
        } catch (error) {
          console.error(`❌ ${provider.key} sync failed for user ${user._id}:`, error.message);
        }
      }
    }
  });

  console.log("🕒 Contact sync scheduler started (daily at 03:00, google + microsoft)");
}
