export interface FreshdeskEnv {
  FRESHDESK_API_KEY?: string;
  FRESHDESK_DOMAIN?: string;
}

export interface FreshdeskTicketPayload {
  subject: string;
  description: string;
  email: string;
  priority: number;
  status: 2;
  tags: string[];
  custom_fields: Record<string, string>;
}

export const FRESHDESK_FIELD_TYPE_SEVERITY = "cf_type_severity";
export const FRESHDESK_FIELD_AREA = "cf_area_of_the_product";
export const FRESHDESK_FIELD_CALL_ID = "cf_call_id";
export const FRESHDESK_FIELD_DEAL_ID = "cf_deal_id";
export const FRESHDESK_FIELD_ACCOUNT_ID = "cf_account_id";
export const FRESHDESK_FIELD_PAGE_CONTEXT = "cf_page_context_hash";

export async function createTicket(
  env: FreshdeskEnv,
  payload: FreshdeskTicketPayload,
): Promise<Record<string, unknown> & { id?: number }> {
  const domain = String(env.FRESHDESK_DOMAIN || "").trim();
  const apiKey = String(env.FRESHDESK_API_KEY || "").trim();
  const response = await fetch(`https://${domain}/api/v2/tickets`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { id?: number };
  if (!response.ok) {
    throw new Error(`Freshdesk ticket creation failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}
