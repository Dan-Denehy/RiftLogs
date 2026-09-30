import { createSampleReplay } from "../src/sampleReplay.ts";
for (const step of createSampleReplay()) {
  console.log(`\n#${step.action.sequence} ${step.action.text}`);
  console.log(JSON.stringify({ context: step.state.context, scores: step.state.scores, resources: step.state.resources, cards: step.state.cards }, null, 2));
  for (const flag of step.flags) console.log(`${flag.status}: ${flag.path}: expected ${JSON.stringify(flag.expected)}, observed ${JSON.stringify(flag.observed)}`);
}
