/**
 * Team structure editor — segment columns for director + segment leaders.
 */

import { esc } from "./shared.js";
import { readFieldValue } from "./crayons-ui.js";
import {
  loadOrgStructure,
  saveOrgStructureReassignments,
  canEditOrgStructure,
} from "./domain/org-structure-service.js";

/**
 * @param {HTMLElement} container
 * @param {object} session
 * @param {{ onSaved?: () => void }} [opts]
 */
export async function renderOrgStructureView(container, session, opts = {}) {
  if (!container || !session) return;

  if (!canEditOrgStructure(session)) {
    container.innerHTML = `
      <fw-inline-message type="warning">
        You do not have permission to edit team structure.
      </fw-inline-message>`;
    return;
  }

  container.innerHTML = `<p class="muted">Loading team structure…</p>`;

  let structure;
  try {
    structure = await loadOrgStructure(session);
  } catch (err) {
    container.innerHTML = `<fw-inline-message type="error">${esc(err.message || "Load failed")}</fw-inline-message>`;
    return;
  }

  const pending = new Map();

  function teamManagersBySegment(segment) {
    /** @type {Map<string, { id: string, teamId: string, displayName?: string, email?: string }>} */
    const map = new Map();
    for (const team of segment.teams || []) {
      if (team.manager) {
        map.set(team.manager.id, {
          ...team.manager,
          teamId: team.id,
        });
      } else if (segment.leader) {
        map.set(segment.leader.id, {
          ...segment.leader,
          teamId: team.id,
        });
      }
    }
    return map;
  }

  function teamManagerOptions(segment, selectedManagerId) {
    return [...teamManagersBySegment(segment).values()]
      .map(
        (m) =>
          `<fw-select-option value="${esc(m.id)}"${m.id === selectedManagerId ? " selected" : ""}>${esc(m.displayName || m.email)}</fw-select-option>`,
      )
      .join("");
  }

  function renderColumns() {
    const cols = (structure.segments || [])
      .map((segment) => {
        const teamBlocks = (segment.teams || [])
          .map((team) => {
            const icRows = (team.ics || [])
              .map((ic) => {
                const key = ic.id;
                const pendingChange = pending.get(key);
                const managerId = pendingChange?.managerId || ic.managerId;
                const teamId = pendingChange?.teamId || ic.teamId;
                const selectId = `mgr-select-${ic.id}`;
                return `
                  <div class="org-structure-ic-row" data-user-id="${esc(ic.id)}">
                    <span class="org-structure-ic-name">${esc(ic.displayName || ic.email)}</span>
                    <fw-select id="${esc(selectId)}" label="Manager" data-user-id="${esc(ic.id)}" data-segment-id="${esc(segment.id)}">
                      ${teamManagerOptions(segment, managerId)}
                    </fw-select>
                  </div>`;
              })
              .join("");
            return `
              <div class="org-structure-team">
                <h3 class="org-structure-team-title">${esc(team.name)}</h3>
                ${team.manager ? `<p class="muted org-structure-team-mgr">Team manager: ${esc(team.manager.displayName || team.manager.email)}</p>` : ""}
                <div class="org-structure-ic-list">${icRows || '<p class="muted">No ICs on this team.</p>'}</div>
              </div>`;
          })
          .join("");
        return `
          <div class="org-structure-column" data-segment-id="${esc(segment.id)}">
            <header class="org-structure-column-head">
              <h2 class="org-structure-column-title">${esc(segment.name)}</h2>
              ${segment.leader ? `<p class="muted">${esc(segment.leader.displayName || segment.leader.email)}</p>` : ""}
            </header>
            ${teamBlocks}
          </div>`;
      })
      .join("");

    container.innerHTML = `
      <div class="org-structure-page">
        <div class="org-structure-head">
          <h1 class="org-structure-title">Team structure</h1>
          <p class="muted">Reassign ICs to team managers within ${structure.canCrossSegment ? "any segment" : "your segment"}. Team managers have read-only access.</p>
        </div>
        <div id="org-structure-msg"></div>
        <div class="org-structure-columns">${cols}</div>
        <div class="org-structure-actions">
          <fw-button id="org-structure-save" color="primary">Save changes</fw-button>
          <fw-button id="org-structure-reset" color="secondary">Reset</fw-button>
        </div>
      </div>`;

    container.querySelectorAll("fw-select[data-user-id]").forEach((el) => {
      el.addEventListener("fwChange", () => {
        const userId = el.getAttribute("data-user-id");
        const segmentId = el.getAttribute("data-segment-id");
        const managerId = readFieldValue(el);
        if (!userId || !managerId) return;
        const segment = structure.segments.find((s) => s.id === segmentId);
        const mgr = segment ? teamManagersBySegment(segment).get(managerId) : null;
        if (!mgr) return;
        pending.set(userId, {
          userId,
          managerId,
          teamId: mgr.teamId,
          fromSegmentId: segmentId,
          toSegmentId: segmentId,
        });
      });
    });

    container.querySelector("#org-structure-reset")?.addEventListener("fwClick", () => {
      pending.clear();
      renderColumns();
    });

    container.querySelector("#org-structure-save")?.addEventListener("fwClick", async () => {
      const msg = container.querySelector("#org-structure-msg");
      const changes = [...pending.values()];
      if (!changes.length) {
        if (msg) msg.innerHTML = `<fw-inline-message type="info">No changes to save.</fw-inline-message>`;
        return;
      }
      try {
        await saveOrgStructureReassignments(session, changes);
        pending.clear();
        structure = await loadOrgStructure(session);
        if (msg) msg.innerHTML = `<fw-inline-message type="success">Structure updated.</fw-inline-message>`;
        opts.onSaved?.();
        renderColumns();
      } catch (err) {
        if (msg) {
          msg.innerHTML = `<fw-inline-message type="error">${esc(err.message || "Save failed")}</fw-inline-message>`;
        }
      }
    });
  }

  renderColumns();
}
