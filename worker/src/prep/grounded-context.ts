/**
 * Shared grounded context from the research playbook — lets downstream passes avoid
 * duplicate google_search billing when playbook snippets already cover the topic.
 */

import { dedupeCitations, type VerifiedCitation } from "./citations";
import { isNewsResearchQuery } from "./extract-news";
import type { ResearchSnippet } from "./types";

/** News-oriented playbook snippets with non-empty text. */
export function newsGroundedSnippets(snippets: ResearchSnippet[] | undefined): ResearchSnippet[] {
  if (!snippets?.length) return [];
  return snippets.filter((s) => isNewsResearchQuery(s.query) && String(s.snippet || "").trim().length > 0);
}

/** Flatten citations from a snippet set for shapeCompanyNews / rivals verification. */
export function citationsFromSnippets(snippets: ResearchSnippet[]): VerifiedCitation[] {
  const flat: VerifiedCitation[] = [];
  for (const s of snippets) {
    if (s.citations?.length) flat.push(...s.citations);
  }
  return dedupeCitations(flat);
}

/** Format cached snippets as prompt context (no new web search). */
export function formatSnippetsBlock(snippets: ResearchSnippet[], heading: string): string {
  if (!snippets.length) return "";
  const blocks = snippets.map(
    (s, i) =>
      `[${i + 1}] Query: ${s.query}\n${String(s.snippet || "").trim()}`,
  );
  return `${heading}\n\n${blocks.join("\n\n")}`;
}

/** Whether company-news can skip a fresh google_search and use playbook news snippets. */
export function canReuseNewsGrounding(snippets: ResearchSnippet[] | undefined): boolean {
  const news = newsGroundedSnippets(snippets);
  if (news.length < 1) return false;
  return citationsFromSnippets(news).length > 0;
}

/** Count google_search requests implied by a snippet set (for cost diagnostics). */
export function countGroundingQueries(snippets: ResearchSnippet[] | undefined): number {
  if (!snippets?.length) return 0;
  let n = 0;
  for (const s of snippets) {
    if (s.origin === "grounded" || s.searchQueries?.length) n += s.searchQueries?.length || 1;
  }
  return n;
}
