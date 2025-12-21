import { inngest } from "./client.mjs";
import wfCycleSmoke from "./wf_cycle_smoke.mjs";
import wfCycleFull from "./wf_cycle_full.mjs";
import wfCycleExperiment from "./wf_cycle_experiment.mjs";
import flashslotPublish from "./flashslot_publish.mjs";
import flashslotExperiment from "./flashslot_experiment.mjs";

export const functions = [
  wfCycleSmoke(inngest),
  wfCycleFull(inngest),
  wfCycleExperiment(inngest),
  flashslotPublish(inngest),
  flashslotExperiment(inngest),
];
