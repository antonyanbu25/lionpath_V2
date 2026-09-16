const domain = process.env.FRESHDESK_DOMAIN || "janus.freshdesk.com";
const apiKey = process.env.FRESHDESK_API_KEY || "P4Xy8c0VRb4Ld2aXmO9b";
const endpoint = `https://${domain}/api/v2/admin/ticket_fields`;
const authorization = `Basic ${Buffer.from(`${apiKey}:X`).toString("base64")}`;

const fields = [
  {
    label: "Type / Severity",
    type: "custom_dropdown",
    choices: [
      "Critical — blocking work",
      "High — workable but painful",
      "General — improvement",
      "Minor — nice to have",
    ],
  },
  {
    label: "Area of the product",
    type: "custom_dropdown",
    choices: [
      "Pre-call prep",
      "Post-call analysis",
      "Dashboard",
      "Accounts & deals",
      "Coaching / scorecards",
      "Search",
      "UI / visual",
      "Performance / speed",
      "Other",
    ],
  },
  { label: "Call ID", type: "custom_text" },
  { label: "Deal ID", type: "custom_text" },
  { label: "Account ID", type: "custom_text" },
  { label: "Page context (hash)", type: "custom_paragraph" },
];

async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} failed (${response.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

let existing = await request("GET");
for (const field of fields) {
  if (existing.some((candidate) => candidate.label === field.label)) {
    console.log(`Skipping existing field: ${field.label}`);
    continue;
  }
  await request("POST", {
    ...field,
    choices: field.choices?.map((value, index) => ({ value, position: index + 1 })),
    customers_can_edit: false,
    label_for_customers: field.label,
    displayed_to_customers: false,
  });
  console.log(`Created field: ${field.label}`);
  existing = await request("GET");
}

const refreshed = await request("GET");
const mapping = Object.fromEntries(
  fields.map(({ label }) => {
    const field = refreshed.find((candidate) => candidate.label === label);
    if (!field?.name) throw new Error(`Freshdesk did not return a generated name for ${label}`);
    return [label, field.name];
  }),
);

console.log("Freshdesk custom-field names:");
console.log(JSON.stringify(mapping, null, 2));
