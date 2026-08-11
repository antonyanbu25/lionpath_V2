#!/usr/bin/env node

const { chromium } = require("playwright");

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error("Usage: entrypoint.sh <URL>");
    process.exit(2);
  }

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 15000 });

    const title = await page.title();
    console.log(`OK ${url} ${title}`);
  } catch (error) {
    console.error(`FAIL ${url}`);
    if (error && error.message) {
      console.error(error.message);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
