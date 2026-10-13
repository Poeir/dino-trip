import { chromium } from 'playwright';

const query = process.argv[2] || 'สุกี้ตี๋น้อย สาขาตลาดอู้ฟู่ ขอนแก่น';
const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}/?hl=en`;

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = await browser.newPage({
  locale: 'en-US',
  viewport: { width: 1280, height: 800 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

console.log('Navigating to', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

try {
  await page.waitForSelector('a.hfpxzc', { timeout: 8000 });
  const first = page.locator('a.hfpxzc').first();
  await first.click();
  console.log('Clicked first search result');
} catch {
  console.log('No search result list detected (maybe already on a place page)');
}

await page.waitForTimeout(3000);

// Expand the opening-hours row, which usually reveals the Popular Times graph too.
try {
  const hoursRow = page.locator('text=/Open|Closed/').first();
  await hoursRow.click({ timeout: 5000 });
  console.log('Clicked hours row to expand');
  await page.waitForTimeout(1500);
} catch (e) {
  console.log('Could not click hours row:', e.message);
}

// Scroll the left info panel down so lazily-rendered sections (like Popular
// times, which sits below the hours table) actually mount into the DOM.
try {
  await page.mouse.move(275, 400);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(400);
  }
} catch (e) {
  console.log('Could not scroll panel:', e.message);
}

const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('Has "Popular times" text on page:', bodyText.includes('Popular times'));
console.log('Has "busy" text on page:', /busy/i.test(bodyText));

const barLabels = await page.$$eval('div[role="img"][aria-label]', (els) =>
  els.map((e) => e.getAttribute('aria-label')).filter((t) => t && /%|busy|Busy/i.test(t))
);
console.log('Candidate bar aria-labels found:', barLabels.length);
console.log(JSON.stringify(barLabels.slice(0, 30), null, 2));

await page.screenshot({
  path: 'C:\\Users\\User\\AppData\\Local\\Temp\\claude\\C--Users-User-Desktop-Project1-main-repo\\aa7d3ac1-89ae-44ff-b999-be0f97d05d2a\\scratchpad\\place_screenshot.png',
  fullPage: false,
});

await browser.close();
