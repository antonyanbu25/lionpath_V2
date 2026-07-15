// Debug Zoom NWS responses for a share link + passcode
const url =
  "https://freshworks.zoom.us/rec/share/6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
const pwd = "$QmaE6xD";
const id = url.match(/\/rec\/share\/([^?\s]+)/)[1];
const base = "https://freshworks.zoom.us/";
const headers = {
  Referer: base,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json,*/*",
};

let cookie = "";
function merge(sc) {
  if (!sc) return;
  const found = sc.match(/(_zm_ssid|cred|_zm_ctaid|_zm_chtaid)=[^;]+/g) || [];
  const jar = new Map();
  for (const p of `${cookie}; ${found.join("; ")}`.split(";")) {
    const [k, ...v] = p.trim().split("=");
    if (k && v.length) jar.set(k, v.join("="));
  }
  cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function get(u, init = {}) {
  const res = await fetch(u, {
    ...init,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
  });
  merge(res.headers.get("set-cookie"));
  const text = await res.text();
  return { status: res.status, text };
}

const share1 = await get(`${base}nws/recording/1.0/play/share-info/${id}`);
console.log("share-info 1:", share1.text.slice(0, 800));
const info1 = JSON.parse(share1.text).result;

if (info1.componentName === "need-password" && info1.meetingId) {
  const val = await get(`${base}nws/recording/1.0/validate-meeting-passwd`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id: info1.meetingId, passwd: pwd, action: "viewdetailpage" }),
  });
  console.log("validate:", val.text);
}

const mid = info1.meetingId;
const share2 = await get(
  `${base}nws/recording/1.0/play/share-info/${mid}?originDomain=${encodeURIComponent("https://freshworks.zoom.us")}&accessLevel=meeting`,
);
const info2 = JSON.parse(share2.text).result;
console.log("share-info 2 redirect:", info2.redirectUrl?.slice(0, 120));

const playUrl = new URL(info2.redirectUrl, base);
playUrl.searchParams.set("pwd", pwd);
playUrl.searchParams.set("continueMode", "true");
const playHtml = await get(playUrl.toString());
const fileId = playHtml.text.match(/fileId\s*:\s*['"]([^'"]+)['"]/)?.[1];
console.log("fileId:", fileId);

const pi = new URL(`nws/recording/1.0/play/info/${fileId}`, base);
pi.searchParams.set("pwd", pwd);
pi.searchParams.set("canPlayFromShare", "true");
pi.searchParams.set("from", "share_recording_detail");
pi.searchParams.set("continueMode", "true");
pi.searchParams.set("componentName", "rec-play");
pi.searchParams.set("originDomain", "https://freshworks.zoom.us");
pi.searchParams.set("originRequestUrl", playUrl.toString());
const playInfo = await get(pi.toString());
console.log("play-info keys:", Object.keys(JSON.parse(playInfo.text).result || {}));
const result = JSON.parse(playInfo.text).result;
console.log("hasTranscript:", result.hasTranscript);
console.log("transcriptUrl:", result.transcriptUrl);
console.log("ccUrl:", result.ccUrl);
console.log("chapterUrl:", result.chapterUrl);
// dump any *Url or *url fields
for (const [k, v] of Object.entries(result)) {
  if (typeof v === "string" && /url|transcript|vtt|cc/i.test(k)) console.log(k, ":", v.slice(0, 120));
}
