import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const filePath = resolve(process.argv[2] ?? "dist/index.html");
await page.goto(pathToFileURL(filePath).href, { waitUntil: "domcontentloaded" });
await page.getByText("Custom saved agents are stored only in this browser.").waitFor({
  timeout: 60000,
});
await page.getByRole("button", { name: "New game", exact: true }).click();
await page.getByText("Agent ready").waitFor();
await page.getByRole("button", { name: /Lock in/ }).click();
await page.getByRole("button", { name: "Skip day" }).click();
await page.getByText("Day 1 results").waitFor();
console.log("offline single-file game flow ok:", filePath);
console.log("errors:", errors.slice(0, 8));
await browser.close();
