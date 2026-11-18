import { chromium } from "playwright-core";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:5179/";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", (dialog) => dialog.accept());
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.getByText("Active agent: Bundled PPO").waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Train your own" }).click();
await page.getByLabel("Name this saved agent").fill("smoke-agent");
await page.waitForFunction(
  () => {
    const button = [...document.querySelectorAll("button")].find((entry) =>
      entry.textContent?.includes("Start training")
    );
    return button && !button.disabled;
  },
  null,
  { timeout: 30000 }
);
await page.getByRole("button", { name: "Start training" }).click();
await page.waitForFunction(
  () =>
    document.body.innerText.includes("Labeling expert games") ||
    document.body.innerText.includes("Cloning the expert"),
  null,
  { timeout: 60000 }
);
await page.getByRole("button", { name: /Stop/ }).click();
await page.getByText("Saved as: smoke-agent").waitFor({ timeout: 120000 });

await page.getByRole("button", { name: "Back" }).click();
const models = page.getByLabel("Opponent model");
await models.locator('option[value="smoke-agent"]').waitFor({
  state: "attached",
  timeout: 15000,
});
await models.selectOption("__bundled_ppo__");
await page.getByRole("button", { name: "Load selected" }).click();
await page.getByText("Active agent: Bundled PPO").waitFor({ timeout: 15000 });
await models.selectOption("smoke-agent");
await page.getByRole("button", { name: "Load selected" }).click();
await page.getByText("Active agent: smoke-agent").waitFor({ timeout: 15000 });

await page.getByRole("button", { name: /Clear saved/ }).click();
await page.getByText("Active agent: Bundled PPO").waitFor({ timeout: 15000 });
if ((await models.locator("option").count()) !== 1) {
  throw new Error("Clearing saved policies removed too few entries");
}
console.log("named save, select, and clear-preserving-bundled passed", errors);
await browser.close();
