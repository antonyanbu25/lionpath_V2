/** Client-side RBAC guards. mirror Firestore security rules. */

import { can, isManagerRole } from "./types.js";
import { sessionUserId } from "./session.js";

/** @param {object|null} session */
export function sessionToUser(session) {
  const id = sessionUserId(session);
  if (!id) return null;
  return {
    id,
    email: session.email,
    displayName: session.name,
    role: session.role || "se",
    teamId: session.teamId || null,
    orgId: session.orgId || null,
    isOrgDirector: session.isOrgDirector === true,
  };
}

/** @param {object|null} session @param {string} action @param {{ ownerId?: string, teamId?: string, orgId?: string }} resource */
export function canSessionAction(session, action, resource = {}) {
  return can(sessionToUser(session), action, resource);
}

export { can, isManagerRole };
export { getVisibleScope } from "./org-service.js";

/** Hide UI elements based on role. */
export function applyRoleVisibility(session, root = document) {
  const isManager = isManagerRole(session?.role);
  root.querySelectorAll("[data-role]").forEach((el) => {
    const role = el.dataset.role;
    if (role === "manager") el.hidden = !isManager;
    else if (role === "se") el.hidden = isManager;
  });
}
