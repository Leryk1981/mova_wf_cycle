import { inngest } from "./client.mjs";
import wfCycleSmoke from "./wf_cycle_smoke.mjs";

export const functions = [
  wfCycleSmoke(inngest),
];
