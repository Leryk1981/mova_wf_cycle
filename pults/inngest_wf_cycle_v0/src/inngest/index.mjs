import { inngest } from "./client.mjs";
import wfCycleSmoke from "./wf_cycle_smoke.mjs";
import wfCycleFull from "./wf_cycle_full.mjs";

export const functions = [
  wfCycleSmoke(inngest),
  wfCycleFull(inngest),
];
