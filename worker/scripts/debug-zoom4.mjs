// check clipDownload
import { readFileSync } from "fs";
// reuse debug flow inline
const url =
  "https://freshworks.zoom.us/rec/share/6MEJ2k7HpXytcPxctK3QbdjAXa5Ia8HKudeGuaCXLCzvJR6kGukUbvTPPVPtzrNK.6vmMiETOazxB3hML";
const pwd = "$QmaE6xD";
const id = url.match(/\/rec\/share\/([^?\s]+)/)[1];
const base = "https://freshworks.zoom.us/";
let cookie = "";
const headers = { Referer: base, "User-Agent": "Mozilla/5.0" };
async function get(u, init = {}) {
  const r = await fetch(u, {
    ...init,
    headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
  });
  const sc = r.headers.get("set-cookie");
  if (sc) {
    for (const p of sc.split(/,(?=\s*[^;]+=)/)) {
      const m = p.match(/(_zm_ssid|cred)=([^;]+)/);
      if (m) cookie = cookie ? `${cookie}; ${m[1]}=${m[2]}` : `${m[1]}=${m[2]}`;
    }
  }
  return r.text();
}
const i1 = JSON.parse(await get(`${base}nws/recording/1.0/play/share-info/${id}`)).result;
await get(`${base}nws/recording/1.0/validate-meeting-passwd`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ id: i1.meetingId, passwd: pwd, action: "viewdetailpage" }),
});
const i2 = JSON.parse(
  await get(
    `${base}nws/recording/1.0/play/share-info/${i1.meetingId}?originDomain=${encodeURIComponent(base.slice(0, -1))}&accessLevel=meeting`,
  ),
).result;
const pu = new URL(i2.redirectUrl, base);
pu.searchParams.set("pwd", pwd);
const html = await get(pu.toString());
const fid = html.match(/fileId\s*:\s*['"]([^'"]+)['"]/)?.[1];
const pi = JSON.parse(
  await get(new URL(`nws/recording/1.0/play/info/${fid}?pwd=${encodeURIComponent(pwd)}&componentName=rec-play`, base)),
).result;
console.log("clipDownload", JSON.stringify(pi.clipDownload, null, 2)?.slice(0, 2000));
