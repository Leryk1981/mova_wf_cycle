import express from "express";
import { serve } from "inngest/express";
import { inngest } from "./src/inngest/client.mjs";
import { functions } from "./src/inngest/index.mjs";

const app = express();
app.use(express.json());
app.use("/api/inngest", serve({ client: inngest, functions }));

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[wf_cycle_pult] listening on http://localhost:${port}`);
});
