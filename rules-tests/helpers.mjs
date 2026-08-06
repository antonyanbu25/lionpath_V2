import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(__dirname, "..", "firestore.rules"), "utf8");

export const PROJECT_ID = "lionpath-rules-test";

/** @returns {Promise<import("@firebase/rules-unit-testing").RulesTestEnvironment>} */
export async function setupEnv() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });
}

export { assertFails, assertSucceeds };

/** Seed authIndex + users + org for a persona. */
export async function seedPersona(env, persona) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { authUid, userId, email, role, teamId, orgId } = persona;
    await db.collection("authIndex").doc(authUid).set({ userId });
    await db.collection("users").doc(userId).set({
      id: userId,
      email,
      authUid,
      role,
      teamId,
      orgId,
      displayName: email,
      status: "active",
    });
    if (persona.org) {
      await db.collection("orgs").doc(orgId).set(persona.org);
    }
    if (persona.team) {
      await db.collection("teams").doc(teamId).set(persona.team);
    }
  });
}

export function authedContext(env, persona) {
  return env.authenticatedContext(persona.authUid, {
    email: persona.email,
    email_verified: true,
  });
}
