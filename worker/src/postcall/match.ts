import {
  corporateDomainsFromEmails,
  emailDomain,
  isFreeMailDomain,
  normalizeEmail,
} from "./participants";
import type {
  AccountMatchResult,
  DealMatchResult,
  MatchReason,
  ResolveAccountSnapshot,
  ResolveBriefSnapshot,
  ResolveDealSnapshot,
} from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SCORE = {
  exactEmail: 100,
  domain: 50,
  recentSameSe: 20,
  fuzzyName: 5,
  titleContains: 3,
} as const;

function normalizeSlug(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyCompanyMatch(a: string, b: string): boolean {
  const sa = normalizeSlug(a);
  const sb = normalizeSlug(b);
  if (!sa || !sb) return false;
  if (sa.includes(sb) || sb.includes(sa)) return true;
  const maxLen = Math.max(sa.length, sb.length);
  if (maxLen < 4) return false;
  return levenshtein(sa, sb) / maxLen <= 0.25;
}

function briefProspectEmails(brief: ResolveBriefSnapshot): string[] {
  const emails = (brief.prospectEmails || [])
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => !!e);
  return emails;
}

function scoreBriefAgainstParticipants(
  brief: ResolveBriefSnapshot,
  participantEmails: Set<string>,
  participantDomains: Set<string>,
  ownerId: string | undefined,
  nowMs: number,
  meetingTitle: string | undefined,
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  let score = 0;
  const briefEmails = briefProspectEmails(brief);
  const briefDomains = new Set(
    briefEmails.map((e) => emailDomain(e)).filter((d): d is string => !!d && !isFreeMailDomain(d)),
  );
  if (brief.domain && !isFreeMailDomain(brief.domain)) {
    briefDomains.add(brief.domain.toLowerCase().replace(/^www\./, ""));
  }

  for (const email of briefEmails) {
    if (participantEmails.has(email)) {
      score += SCORE.exactEmail;
      reasons.push({
        rank: 1,
        signal: "exact_prospect_email",
        detail: `${email} appears in the pre-call brief and on this call`,
      });
      break;
    }
  }

  for (const domain of briefDomains) {
    if (participantDomains.has(domain)) {
      score += SCORE.domain;
      reasons.push({
        rank: 2,
        signal: "domain_match",
        detail: `Domain ${domain} matches the brief and a participant`,
      });
      break;
    }
  }

  if (ownerId && brief.ownerId === ownerId && nowMs - brief.createdAt <= THIRTY_DAYS_MS) {
    score += SCORE.recentSameSe;
    reasons.push({
      rank: 3,
      signal: "recent_brief_same_se",
      detail: "Pre-call brief for this account within the last 30 days by you",
    });
  }

  if (meetingTitle && fuzzyCompanyMatch(meetingTitle, brief.companyName)) {
    score += SCORE.fuzzyName;
    reasons.push({
      rank: 4,
      signal: "company_name_fuzzy",
      detail: `Meeting title resembles ${brief.companyName}`,
    });
  }

  return { score, reasons };
}

function scoreAccountTitleMatch(
  accountName: string,
  meetingTitle: string | undefined,
): MatchReason | null {
  if (!meetingTitle || !fuzzyCompanyMatch(meetingTitle, accountName)) return null;
  return {
    rank: 5,
    signal: "title_contains_account",
    detail: `Meeting title mentions ${accountName}`,
  };
}

function dedupeReasons(reasons: MatchReason[]): MatchReason[] {
  const seen = new Set<string>();
  const out: MatchReason[] = [];
  for (const r of reasons) {
    const key = `${r.rank}:${r.signal}:${r.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export function resolveAccountMatch(
  briefs: ResolveBriefSnapshot[],
  accounts: ResolveAccountSnapshot[],
  participantEmails: string[],
  ownerId: string | undefined,
  meetingTitle: string | undefined,
  nowMs = Date.now(),
): AccountMatchResult | null {
  const emailSet = new Set(participantEmails);
  const domainSet = new Set(corporateDomainsFromEmails(participantEmails));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  let best: AccountMatchResult | null = null;

  for (const brief of briefs) {
    const { score, reasons } = scoreBriefAgainstParticipants(
      brief,
      emailSet,
      domainSet,
      ownerId,
      nowMs,
      meetingTitle,
    );
    if (score <= 0) continue;

    const account = accountById.get(brief.accountId);
    const accountName = account?.name || brief.companyName;
    const titleReason = account ? scoreAccountTitleMatch(account.name, meetingTitle) : null;
    let total = score + (titleReason ? SCORE.titleContains : 0);
    const allReasons = dedupeReasons([...reasons, ...(titleReason ? [titleReason] : [])]);

    if (!best || total > best.score) {
      best = {
        accountId: brief.accountId,
        accountName,
        score: total,
        reasons: allReasons,
        matchedBriefId: brief.id,
      };
    }
  }

  // Domain-only account match when no brief matched (corporate domain on account record).
  if (!best) {
    for (const account of accounts) {
      const domain = account.domain?.toLowerCase().replace(/^www\./, "");
      if (!domain || isFreeMailDomain(domain) || !domainSet.has(domain)) continue;
      const reasons: MatchReason[] = [
        {
          rank: 2,
          signal: "domain_match",
          detail: `Participant domain matches account ${account.name}`,
        },
      ];
      const titleReason = scoreAccountTitleMatch(account.name, meetingTitle);
      let score = SCORE.domain;
      if (titleReason) {
        score += SCORE.titleContains;
        reasons.push(titleReason);
      }
      if (!best || score > best.score) {
        best = {
          accountId: account.id,
          accountName: account.name,
          score,
          reasons: dedupeReasons(reasons),
        };
      }
    }
  }

  return best;
}

export function rankDealsOnAccount(
  accountMatch: AccountMatchResult,
  deals: ResolveDealSnapshot[],
  briefs: ResolveBriefSnapshot[],
  participantEmails: string[],
  ownerId: string | undefined,
  meetingTitle: string | undefined,
  nowMs = Date.now(),
): DealMatchResult[] {
  const accountDeals = deals.filter((d) => d.accountId === accountMatch.accountId);
  const emailSet = new Set(participantEmails);
  const domainSet = new Set(corporateDomainsFromEmails(participantEmails));
  const accountBriefs = briefs.filter((b) => b.accountId === accountMatch.accountId);

  const ranked = accountDeals.map((deal) => {
    const linkedBriefs = accountBriefs.filter((b) => b.dealId === deal.id);
    let score = 0;
    let reasons: MatchReason[] = [];

    for (const brief of linkedBriefs.length ? linkedBriefs : accountBriefs) {
      const hit = scoreBriefAgainstParticipants(
        brief,
        emailSet,
        domainSet,
        ownerId,
        nowMs,
        meetingTitle,
      );
      if (hit.score > score) {
        score = hit.score;
        reasons = hit.reasons;
      }
    }

    if (score === 0 && accountMatch.reasons.length) {
      score = Math.max(1, Math.floor(accountMatch.score / 2));
      reasons = [
        {
          rank: 2,
          signal: "same_account",
          detail: `On ${accountMatch.accountName} — confirm this is the right opportunity`,
        },
      ];
    }

    return {
      dealId: deal.id,
      accountId: deal.accountId,
      title: deal.title,
      type: deal.type,
      stage: deal.stage,
      score,
      reasons: dedupeReasons(reasons),
      preselected: false,
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (ranked.length) ranked[0].preselected = true;
  return ranked;
}

export function suggestedCompanyName(
  meetingTitle: string | undefined,
  participantEmails: string[],
): string | undefined {
  if (meetingTitle) {
    const cleaned = meetingTitle
      .replace(/\b(demo|discovery|call|meeting|sync|review|with|and)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length >= 3) return cleaned.slice(0, 80);
  }
  const corp = corporateDomainsFromEmails(participantEmails)[0];
  if (corp) {
    const base = corp.split(".")[0];
    if (base.length >= 3) return base.charAt(0).toUpperCase() + base.slice(1);
  }
  return undefined;
}
