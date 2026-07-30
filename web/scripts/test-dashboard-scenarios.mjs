import { chromium } from "playwright";

async function scenario(name, fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  try {
    const result = await fn(page);
    console.log(`OK  ${name}:`, JSON.stringify({ ...result, errors }));
    if (result.fail) throw new Error(name);
  } catch (err) {
    console.error(`FAIL ${name}:`, err.message, errors);
    await browser.close();
    process.exit(1);
  }
  await browser.close();
}

function dashState(page) {
  return page.evaluate(() => {
    const el = document.getElementById("view-dashboard");
    const mgr = document.getElementById("view-manager");
    const ws = document.getElementById("view-workspace");
    return {
      hash: location.hash,
      title: document.getElementById("main-view-title")?.textContent,
      dashHidden: el?.hidden,
      dashLen: el?.innerHTML?.length ?? 0,
      dashText: el?.innerText?.slice(0, 120),
      mgrHidden: mgr?.hidden,
      mgrLen: mgr?.innerHTML?.length ?? 0,
      wsHidden: ws?.hidden,
    };
  });
}

await scenario("SE fresh login", async (page) => {
  await page.goto("http://127.0.0.1:8788/");
  await page.fill("#login-email", "se@freshworks.com");
  await page.fill("#login-password", "se123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#app-shell:not([hidden])");
  await page.waitForTimeout(400);
  const s = await dashState(page);
  return { ...s, fail: s.dashHidden || s.dashLen < 200 };
});

await scenario("SE reload with session #dashboard", async (page) => {
  await page.goto("http://127.0.0.1:8788/");
  await page.fill("#login-email", "se@freshworks.com");
  await page.fill("#login-password", "se123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#app-shell:not([hidden])");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const s = await dashState(page);
  return { ...s, fail: s.dashHidden || s.dashLen < 200 };
});

await scenario("SE hash #workspace on login", async (page) => {
  await page.goto("http://127.0.0.1:8788/#workspace");
  await page.fill("#login-email", "se@freshworks.com");
  await page.fill("#login-password", "se123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#app-shell:not([hidden])");
  await page.waitForTimeout(400);
  const s = await dashState(page);
  return { ...s, fail: s.wsHidden };
});

await scenario("Manager login lands on manager view", async (page) => {
  await page.goto("http://127.0.0.1:8788/");
  await page.fill("#login-email", "manager@freshworks.com");
  await page.fill("#login-password", "mgr123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#app-shell:not([hidden])");
  await page.waitForTimeout(400);
  const s = await dashState(page);
  return { ...s, fail: s.mgrHidden || s.mgrLen < 200 };
});

await scenario("Production SE login", async (page) => {
  await page.goto("https://portal.benjaminsquare.com/");
  await page.fill("#login-email", "se@freshworks.com");
  await page.fill("#login-password", "se123");
  await page.click('button[type="submit"]');
  await page.waitForSelector("#app-shell:not([hidden])");
  await page.waitForTimeout(400);
  const s = await dashState(page);
  return { ...s, fail: s.dashHidden || s.dashLen < 200 };
});

console.log("\nAll dashboard edge-case scenarios passed");
