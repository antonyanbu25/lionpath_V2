/** Deterministic search query list — same inputs always produce the same queries. */

export interface PlaybookInput {
  companyName: string;
  companyDomain: string;
  emails: string[];
}

export function buildPlaybookQueries(
  input: PlaybookInput,
  options?: { skipLinkedInForEmails?: Set<string> },
): string[] {
  const { companyName, companyDomain, emails } = input;
  const skip = options?.skipLinkedInForEmails;
  const queries = [
    `site:${companyDomain} (about OR company OR "who we are")`,
    `site:${companyDomain} (support OR help OR careers OR jobs)`,
    `site:${companyDomain} (zendesk OR intercom OR freshdesk OR "help center")`,
    `"${companyName}" news OR funding`,
  ];

  for (const email of emails) {
    if (skip?.has(email.toLowerCase())) continue;
    const local = email.split("@")[0]?.replace(/[.+]/g, " ").trim();
    if (local) {
      queries.push(`"${local}" "${companyName}" site:linkedin.com/in`);
    }
  }

  return queries;
}
