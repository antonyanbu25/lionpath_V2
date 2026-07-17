import type { PersonResearchFragment, ResearchEnv } from "../types";

const FETCH_TIMEOUT_MS = 10000;

interface ZoomInfoJobHistory {
  companyName?: string;
  title?: string;
  fromDate?: string;
  toDate?: string;
}

interface ZoomInfoPersonResponse {
  data?: {
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    managementLevel?: string;
    yearsOfExperience?: number;
    jobHistory?: ZoomInfoJobHistory[];
    technologies?: string[];
  };
}

/** ZoomInfo person enrich — requires ZOOMINFO_API_KEY; logs and returns null when absent. */
export async function fetchZoomInfoPerson(
  env: ResearchEnv,
  email: string,
  companyName: string,
  prospectName?: string,
): Promise<PersonResearchFragment | null> {
  const key = env.ZOOMINFO_API_KEY?.trim();
  if (!key) {
    console.info("[research] ZOOMINFO_API_KEY not set — skipping ZoomInfo person lookup");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.zoominfo.com/gtm/lookup/v1/person/enrich", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        emailAddress: email,
        companyName,
        fullName: prospectName || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[research] ZoomInfo lookup failed (${res.status}): ${body.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as ZoomInfoPersonResponse;
    const person = data.data;
    if (!person) return null;

    const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
    const priorEmployers = (person.jobHistory || [])
      .map((j) => j.companyName?.trim())
      .filter(Boolean)
      .slice(0, 4) as string[];

    const years =
      typeof person.yearsOfExperience === "number" && person.yearsOfExperience > 0
        ? `${person.yearsOfExperience} years`
        : undefined;

    const role = person.jobTitle?.trim();
    const summaryParts = [years, role, priorEmployers.length ? `background at ${priorEmployers.slice(0, 2).join(", ")}` : ""]
      .filter(Boolean)
      .join("; ");

    return {
      source: "zoominfo",
      email,
      name: name || undefined,
      role,
      totalExperience: years,
      experienceSummary: summaryParts || undefined,
      priorEmployers,
      competitorTouchpoints: (person.technologies || [])
        .filter((t) => /zendesk|intercom|zoho|salesforce|servicenow|freshdesk/i.test(t))
        .slice(0, 4),
      url: "https://www.zoominfo.com",
      confidence: 85,
    };
  } catch (err) {
    console.warn(`[research] ZoomInfo error: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
