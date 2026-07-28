// Zoom OAuth + recording fetch.
//
// Two paths exist:
// 1. Server-to-Server OAuth (ZOOM_ACCOUNT_ID + client id/secret) — the reliable path.
//    Freshworks share links answer `needRecaptcha: true` on the very first share-info
//    call, so the passcode scrape in zoomShare.ts cannot unlock them. The API can.
// 2. User OAuth (ZOOM_REDIRECT_URI) — kept for a future per-SE connect flow.

export interface ZoomEnv {
  ZOOM_ACCOUNT_ID?: string;
  ZOOM_CLIENT_ID?: string;
  ZOOM_CLIENT_SECRET?: string;
  ZOOM_REDIRECT_URI?: string;
}

export function zoomConfigured(env: ZoomEnv): boolean {
  return !!(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET && env.ZOOM_REDIRECT_URI);
}

/** Server-to-Server OAuth — account-level recording reads, no SE interaction. */
export function zoomApiConfigured(env: ZoomEnv): boolean {
  return !!(env.ZOOM_ACCOUNT_ID && env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET);
}

export function zoomAuthUrl(env: ZoomEnv, state: string): string {
  if (!zoomConfigured(env)) {
    throw new Error("Zoom OAuth is not configured on the server.");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ZOOM_CLIENT_ID!,
    redirect_uri: env.ZOOM_REDIRECT_URI!,
    state,
  });
  return `https://zoom.us/oauth/authorize?${params}`;
}

/**
 * After OAuth, fetch cloud recording transcripts for a meeting.
 * Requires scopes: recording:read, user:read
 * Zoom returns VTT at recording_files[].download_url when recording_type includes TRANSCRIPT.
 */
export async function fetchMeetingTranscript(
  accessToken: string,
  meetingUuid: string,
): Promise<string> {
  const encoded = encodeURIComponent(encodeURIComponent(meetingUuid));
  const recRes = await fetch(
    `https://api.zoom.us/v2/meetings/${encoded}/recordings`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!recRes.ok) {
    const body = await recRes.text();
    throw new Error(`Zoom recordings API ${recRes.status}: ${body.slice(0, 300)}`);
  }
  const data = (await recRes.json()) as {
    recording_files?: { file_type?: string; download_url?: string }[];
  };
  const transcriptFile = (data.recording_files || []).find(
    (f) => f.file_type === "TRANSCRIPT" || f.file_type === "CC",
  );
  if (!transcriptFile?.download_url) {
    throw new Error("No transcript found for this meeting. Ensure cloud recording + audio transcript is enabled.");
  }
  const vttRes = await fetch(transcriptFile.download_url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!vttRes.ok) throw new Error(`Could not download transcript (${vttRes.status}).`);
  return vttRes.text();
}

export interface PastMeeting {
  uuid: string;
  topic: string;
  start_time: string;
  duration: number;
  has_recording: boolean;
}

/** List recent meetings with recordings for the authenticated user. */
export async function listPastMeetings(accessToken: string): Promise<PastMeeting[]> {
  const res = await fetch(
    "https://api.zoom.us/v2/users/me/recordings?meeting_type=2&page_size=30",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zoom recordings list ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    meetings?: {
      uuid: string;
      topic: string;
      start_time: string;
      duration: number;
      recording_count?: number;
    }[];
  };
  return (data.meetings || []).map((m) => ({
    uuid: m.uuid,
    topic: m.topic,
    start_time: m.start_time,
    duration: m.duration,
    has_recording: (m.recording_count || 0) > 0,
  }));
}
