import "dotenv/config";
import express from "express";
import { extractInboundMessages, sendWhatsAppMessage } from "../whatsapp/client.js";
import { handleIncomingMessage } from "../whatsapp/messageHandler.js";
import { startJobs } from "../jobs/index.js";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Meta webhook verification handshake
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Meta sends inbound messages here
app.post("/webhook", (req, res) => {
  // Respond immediately; Meta requires a fast 200 and retries on timeout.
  res.sendStatus(200);

  const messages = extractInboundMessages(req.body);
  for (const msg of messages) {
    handleIncomingMessage(msg.from, msg.text)
      .then((reply) => sendWhatsAppMessage(msg.from, reply))
      .catch((err) => console.error(`failed to handle message ${msg.messageId}:`, err));
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`nomu webhook server listening on :${PORT}`);
  startJobs();
});
