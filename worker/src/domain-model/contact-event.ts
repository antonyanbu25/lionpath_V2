/** Append-only audit trail for a contact. */

export type ContactEventType =
  | "contact_created"
  | "field_updated"
  | "disc_updated"
  | "influence_updated"
  | "linked_from_prep"
  | "linked_from_postcall";

export interface ContactEvent {
  id: string;
  contactId: string;
  type: ContactEventType;
  actorId: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

export const CONTACT_EVENT_LABELS: Record<ContactEventType, string> = {
  contact_created: "Contact created",
  field_updated: "Field updated",
  disc_updated: "DISC updated",
  influence_updated: "Influence updated",
  linked_from_prep: "Linked from prep",
  linked_from_postcall: "Linked from post-call",
};
