import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5179/";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const play = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Play vs selected agent")
  );
  return play && !play.disabled;
});
await page.getByRole("button", { name: /Play vs selected agent/ }).click();
await page.getByText("Your machine").waitFor();
await page.getByText("Agent ready").waitFor();
await page.screenshot({
  path: "C:/Users/arrud/AppData/Local/Temp/opencode/planning-layout.png",
});
await page.getByRole("button", { name: "Add slot", exact: true }).first().click();
await page.getByRole("button", { name: /Lock in/ }).click();
await page.getByText("Skip day").waitFor();
await page.waitForTimeout(500);
console.log(
  "canvas rect:",
  await page.locator("canvas").evaluate((canvas) =>
    canvas.getBoundingClientRect().toJSON()
  )
);
await page.screenshot({
  path: "C:/Users/arrud/AppData/Local/Temp/opencode/capybara-replay.png",
});
await page.getByRole("button", { name: "Skip day" }).click();
await page.getByText("Day 1 results").waitFor();
console.log("replay and skip ok; errors:", errors);
await browser.close();
