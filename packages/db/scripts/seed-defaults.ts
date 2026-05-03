import { db } from "../src/client.js";
import { roleRateLimits } from "../src/schema/index.js";

async function seedDefaults() {
  // デフォルト（ロール未割当ユーザー）の上限：後で変更可能
  await db.insert(roleRateLimits)
    .values({
      discordRoleId: "__default__",
      roleLabel: "Default (all users)",
      dailyLimit: 10,
    })
    .onConflictDoNothing();

  console.log("Default rate limit seeded: 10/day");
  process.exit(0);
}

seedDefaults().catch((err) => {
  console.error(err);
  process.exit(1);
});
