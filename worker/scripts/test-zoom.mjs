import { fetchRecordingFromShareLink, preferredMediaStream } from "../src/zoomShare.ts";

const url = process.argv[2];
const pwd = process.argv[3];
if (!url) {
  console.error("Usage: node --import tsx scripts/test-zoom.mjs <share-url> [passcode]");
  process.exit(1);
}

try {
  const r = await fetchRecordingFromShareLink(url, pwd);
  const preferred = preferredMediaStream(r.media);
  console.log("OK", {
    source: r.source,
    topic: r.topic,
    transcriptChars: r.transcript.length,
    mediaStreams: r.media?.streams.map((s) => s.kind) ?? [],
    preferredKind: preferred?.kind,
    durationSec: r.media?.durationSec,
    disableDownload: r.media?.disableDownload,
    totalClips: r.media?.totalClips,
  });
  console.log(r.transcript.slice(0, 300));
} catch (e) {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
}
