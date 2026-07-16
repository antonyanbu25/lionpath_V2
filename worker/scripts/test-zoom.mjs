import { fetchTranscriptFromShareLink } from "../src/zoomShare.ts";

const url =
  "https://freshworks.zoom.us/rec/share/6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
const pwd = "$QmaE6xD";

try {
  const r = await fetchTranscriptFromShareLink(url, pwd);
  console.log("OK", r.source, r.topic, r.transcript.slice(0, 300));
} catch (e) {
  console.error("FAIL", e.message);
}
