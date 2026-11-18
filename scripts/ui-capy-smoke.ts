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

const wholesaleSource = page.locator('.item-name[draggable="true"]').first();
const itemName = await wholesaleSource.locator("strong").innerText();
const machineCard = page.locator(".slot").filter({ hasText: itemName });
await wholesaleSource.dragTo(page.locator(".slot-grid"));
await machineCard.getByText("Buy now +5").waitFor();
if (
  (await page.locator(".slot:not(.empty)").filter({ hasText: itemName }).count()) !==
  1
) {
  throw new Error("Dragging a product created a duplicate machine slot");
}

const catalogRow = page.locator(".item-row").filter({ hasText: itemName });
await catalogRow.getByRole("button", { name: "Buy max" }).click();
await machineCard.getByRole("button", { name: "Move +10" }).click();
await machineCard.getByText("From backstock +10").waitFor();
await machineCard.getByRole("button", { name: "Undo refill" }).click();
await machineCard.getByText("From backstock +0").waitFor();

await catalogRow
  .locator('.backstock-count[draggable="true"]')
  .dragTo(page.locator(".slot-grid"));
await machineCard.getByText("From backstock +10").waitFor();
if (
  (await page.locator(".slot:not(.empty)").filter({ hasText: itemName }).count()) !==
  1
) {
  throw new Error("Dragging backstock created a duplicate machine slot");
}

const refillAll = page.getByRole("button", { name: "Refill all" });
if (!(await refillAll.isDisabled())) {
  throw new Error("Refill all stayed enabled after the slot reached capacity");
}
await machineCard.getByRole("button", { name: "Undo refill" }).click();
await refillAll.click();
await machineCard.getByText("From backstock +10").waitFor();
if (!(await refillAll.isDisabled())) {
  throw new Error("Refill all stayed enabled after refilling the slot to capacity");
}

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
