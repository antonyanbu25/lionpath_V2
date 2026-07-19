/** Deterministic search query list — same inputs always produce the same queries. */

export interface PlaybookInput {
  companyName: string;
  companyDomain: string;
  emails: string[];
}

export function buildPlaybookQueries(input: PlaybookInput): string[] {
  const { companyName, companyDomain, emails } = input;
  const queries = [
    `site:${companyDomain} (about OR company OR "who we are")`,
    `site:${companyDomain} (support OR help OR careers OR jobs)`,
    `site:${companyDomain} (zendesk OR intercom OR freshdesk OR "help center")`,
    `"${companyName}" news OR funding`,
  ];

  for (const email of emails) {
    const local = email.split("@")[0]?.replace(/[.+]/g, " ").trim();
    if (local) {
      queries.push(`"${local}" "${companyName}" site:linkedin.com/in`);
    }
  }

  return queries;
}
