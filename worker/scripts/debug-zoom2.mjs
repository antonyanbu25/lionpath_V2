const url =
  "https://freshworks.zoom.us/rec/share/6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
const pwd = "$QmaE6xD";
const id = url.match(/\/rec\/share\/([^?\s]+)/)[1];
const base = "https://freshworks.zoom.us/";
const headers = {
  Referer: base,
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
};
let cookie = "";
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
const fileId = html.match(/fileId\s*:\s*['"]([^'"]+)['"]/)?.[1];
const pi = new URL(`nws/recording/1.0/play/info/${fileId}`, base);
pi.searchParams.set("pwd", pwd);
pi.searchParams.set("canPlayFromShare", "true");
pi.searchParams.set("componentName", "rec-play");
const result = JSON.parse(await get(pi.toString())).result;

console.log("transcribing:", result.transcribing);
console.log("totalClips:", result.totalClips);
console.log("vttRanges:", JSON.stringify(result.vttRanges)?.slice(0, 500));
console.log("recording:", JSON.stringify(result.recording)?.slice(0, 800));

if (result.chapterUrl) {
  const vtt = await get(new URL(result.chapterUrl, base).toString());
  console.log("\n--- chapter VTT first 1500 chars ---\n", vtt.slice(0, 1500));
}

// Try caption/transcript endpoints
for (const action of ["transcript", "cc", "caption"]) {
  const u = new URL("nws/recording/1.0/play/vtt", base);
  u.searchParams.set("fid", fileId);
  u.searchParams.set("action", action);
  u.searchParams.set("pwd", pwd);
  try {
    const t = await get(u.toString());
    if (t.includes("WEBVTT") || t.includes("-->")) {
      console.log(`\n--- ${action} VTT ---\n`, t.slice(0, 800));
    } else {
      console.log(`${action} response:`, t.slice(0, 200));
    }
  } catch (e) {
    console.log(action, "failed", e.message);
  }
}
