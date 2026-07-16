const url =
  "https://freshworks.zoom.us/rec/share/6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
const pwd = "$QmaE6xD";
const id = url.match(/\/rec\/share\/([^?\s]+)/)[1];
const base = "https://freshworks.zoom.us/";
let cookie = "";
const headers = { Referer: base, "User-Agent": "Mozilla/5.0 Chrome/120.0.0.0" };
function merge(sc) {
  if (!sc) return;
  for (const p of sc.split(/,(?=\s*[^;]+=)/)) {
    const m = p.match(/(_zm_ssid|cred|_zm_ctaid|_zm_chtaid)=([^;]+)/);
    if (m) cookie = cookie ? `${cookie}; ${m[1]}=${m[2]}` : `${m[1]}=${m[2]}`;
  }
}
async function get(u, init = {}) {
  const res = await fetch(u, {
    ...init,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
  });
  merge(res.headers.get("set-cookie"));
  return res.text();
}

const info1 = JSON.parse(await get(`${base}nws/recording/1.0/play/share-info/${id}`)).result;
await get(`${base}nws/recording/1.0/validate-meeting-passwd`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ id: info1.meetingId, passwd: pwd, action: "viewdetailpage" }),
});
const info2 = JSON.parse(
  await get(
    `${base}nws/recording/1.0/play/share-info/${info1.meetingId}?originDomain=${encodeURIComponent(base.slice(0, -1))}&accessLevel=meeting`,
  ),
).result;
const playUrl = new URL(info2.redirectUrl, base);
playUrl.searchParams.set("pwd", pwd);
const html = await get(playUrl.toString());

// Find transcript/download links in HTML
const links = [...html.matchAll(/https?:\/\/[^"'\s]+|\/nws\/[^"'\s]+|\/rec\/[^"'\s]+/g)]
  .map((m) => m[0])
  .filter((l) => /transcript|vtt|caption|cc|download|TIMELINE|audio_transcript/i.test(l));
console.log("interesting links in HTML:", [...new Set(links)].slice(0, 30));

const transcriptMentions = [...html.matchAll(/transcript[^"']{0,80}/gi)].map((m) => m[0]).slice(0, 15);
console.log("transcript mentions:", transcriptMentions);

// Try detail/download component
const fileId = html.match(/fileId\s*:\s*['"]([^'"]+)['"]/)?.[1];
for (const path of [
  `nws/recording/1.0/download/info/${fileId}?pwd=${encodeURIComponent(pwd)}`,
  `nws/recording/1.0/play/download/${fileId}?pwd=${encodeURIComponent(pwd)}`,
  `nws/recording/1.0/recording/info/${info1.meetingId}?pwd=${encodeURIComponent(pwd)}`,
]) {
  try {
    const t = await get(new URL(path, base).toString());
    if (t.includes("TRANSCRIPT") || t.includes("transcript") || t.includes(".vtt")) {
      console.log(`\n${path}:\n`, t.slice(0, 1200));
    }
  } catch {}
}

const pi = JSON.parse(
  await get(
    new URL(`nws/recording/1.0/play/info/${fileId}?pwd=${encodeURIComponent(pwd)}&componentName=rec-play`, base),
  ),
).result;
console.log("numOfClipFile:", pi.numOfClipFile, "totalClips:", pi.totalClips, "currentClip:", pi.currentClip);
console.log("hasAiAnalyzeResult:", pi.hasAiAnalyzeResult, "needMeetingCoach:", pi.needMeetingCoach);
