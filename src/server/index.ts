import "dotenv/config";
import express from "express";
import { startPolling } from "../telegram/poller.js";
import { startJobs } from "../jobs/index.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`nomu health server listening on :${PORT}`);
  startPolling();
  startJobs();
});
