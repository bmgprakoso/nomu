import { extractTextMessage, getUpdates, sendTelegramMessage } from "./client.js";
import { handleIncomingMessage } from "./messageHandler.js";

const POLL_TIMEOUT_SECONDS = 30;

export function startPolling() {
  let offset = 0;
  let stopped = false;

  (async () => {
    console.log("telegram long-polling started");
    while (!stopped) {
      try {
        const updates = await getUpdates(offset, POLL_TIMEOUT_SECONDS);
        for (const update of updates) {
          offset = update.update_id + 1;
          const parsed = extractTextMessage(update);
          if (!parsed) continue;

          handleIncomingMessage(parsed.chatId, parsed.text)
            .then((reply) => sendTelegramMessage(parsed.chatId, reply))
            .catch((err) => console.error(`failed to handle update ${update.update_id}:`, err));
        }
      } catch (err) {
        console.error("polling error, retrying in 5s:", err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
