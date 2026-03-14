import { sendPushToPlayer, getTokensForPlayer } from "../src/notifications/notificationService.js";
import "../src/db/db.js"; // Initialize DB

async function testPush() {
  const playerId = process.argv[2];
  if (!playerId) {
    console.error("Usage: node scripts/send-test-push.js <playerId>");
    process.exit(1);
  }

  const tokens = getTokensForPlayer(playerId);
  if (tokens.length === 0) {
    console.error(`No push tokens found for player: ${playerId}`);
    console.log("Make sure you have joined a room on a physical device to register a token.");
    process.exit(1);
  }

  console.log(`Found ${tokens.length} token(s) for player ${playerId}. Sending Push...`);
  await sendPushToPlayer(
    playerId, 
    "Jet Lag App Test", 
    "This is a test background push notification!", 
    { customData: "123" }
  );
  console.log("Push notification sent via Expo Push Service!");
}

testPush().catch(console.error);
