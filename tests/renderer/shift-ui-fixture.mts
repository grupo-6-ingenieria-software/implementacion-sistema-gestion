import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";

export async function withShiftUi(name: string, run: (page: Page, url: string, output: string) => Promise<void>) {
  const server = await createServer({
    configFile: false, root: process.cwd(), plugins: [tailwindcss()],
    esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0 },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen();
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ].find(existsSync),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const output = join(process.cwd(), "out", `${name}-qa`);
    mkdirSync(output, { recursive: true });
    await run(page, `${server.resolvedUrls!.local[0]}tests/renderer/cu28-harness.html`, output);
    assert.deepEqual(errors, []);
    console.log(`${name}: UI con IPC simulado y AppShell real OK. Capturas: ${output}`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

export const settle = (page: Page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));
