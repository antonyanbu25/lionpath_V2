import { stepsFromNextSteps } from "../follow-ups.js";

const objectFormat = {
  seActions: [{ action: "Provide trial sign-up link", dueHint: "Within 24 hours" }],
  aeActions: [{ action: "Schedule follow-up", dueHint: "Next week" }],
  suggestedFollowUpEmail: { subject: "Thanks", body: "Hi" },
};

const arrayFormat = [{ owner: "SE", action: "Send deck", due: "Friday" }];

const fromObject = stepsFromNextSteps(objectFormat);
const fromArray = stepsFromNextSteps(arrayFormat);
const fromNull = stepsFromNextSteps(null);

if (fromObject.length !== 2) {
  console.error("expected 2 steps from object, got", fromObject.length);
  process.exit(1);
}
if (fromArray.length !== 1 || fromArray[0].action !== "Send deck") {
  console.error("array format failed", fromArray);
  process.exit(1);
}
if (fromNull.length !== 0) {
  console.error("null should be empty");
  process.exit(1);
}

// Reproduce the old crash path
const bad = { analysis: { nextSteps: objectFormat, qualityCoach: { overallScore: 7 } } };
const nextStep = stepsFromNextSteps(bad.analysis?.nextSteps).find((s) => s.action)?.action;
if (!nextStep) {
  console.error("find on normalized steps failed");
  process.exit(1);
}

console.log("OK — stepsFromNextSteps handles object and array formats");
