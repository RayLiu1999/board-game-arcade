import { expect, test } from "@playwright/test";

test("3D reversi shares legal moves, flips, undo and saved view with 2D", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/reversi-3d.js")) requests.push(request.url());
  });
  await page.goto("/");
  await page.locator('[data-game="reversi"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  expect(requests).toHaveLength(0);
  await page.locator("#reversi-3d-toggle").click();
  await expect(page.locator("#reversi-3d-scene canvas")).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.keyboard.press("Enter");
  await expect(page.locator("#move-count")).toHaveText("1 手");
  await expect(page.locator("#score-info")).toHaveText("黑 4 子 · 白 1 子");
  await page.locator("#reversi-3d-toggle").click();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator('#board [data-cell="27"]')).toHaveAttribute(
    "aria-label",
    /黑/,
  );
  await page.locator("#undo-button").click();
  await expect(page.locator("#score-info")).toHaveText("黑 2 子 · 白 2 子");
  await page.locator("#reversi-3d-toggle").click();
  await page.locator("#table-figures-toggle").click();
  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator("#reversi-3d-scene canvas")).toBeVisible();
  await expect(page.locator("#table-figures-toggle")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#reversi-3d-toggle").click();
  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator("#reversi-3d-scene")).toBeHidden();
});

test("phone 3D reversi accepts touches and rejects occupied squares", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('[data-game="reversi"]').click();
    await page.locator('[data-mode="local"]').click();
    await page.locator("#start-button").click();
    await page.locator("#reversi-3d-toggle").click();
    const canvas = page.locator("#reversi-3d-scene canvas");
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error("Missing 3D canvas");
    // Fixed camera: D3 projects just above the center; D4 is occupied.
    await canvas.tap({
      position: { x: bounds.width * 0.445, y: bounds.height * 0.38 },
    });
    await expect(page.locator("#move-count")).toHaveText("1 手");
    await canvas.tap({
      position: { x: bounds.width * 0.445, y: bounds.height * 0.455 },
    });
    await expect(page.locator("#move-count")).toHaveText("1 手");
    await expect(page.locator("#turn-title")).toContainText("白方");
  } finally {
    await context.close();
  }
});

test("3D reversi syncs flips online and restores on room rejoin", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.locator('[data-game="reversi"]').click();
  await page.locator('[data-mode="online"]').click();
  await page.locator("#player-name").fill("黑方");
  await page.locator("#start-button").click();
  await expect(page.locator("#room-code")).toBeVisible();
  const code = (await page.locator("#room-code").textContent())?.trim() ?? "";
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto("/");
    await guest.locator("#header-join").click();
    await guest.locator("#join-code").fill(code);
    await guest.locator("#join-name").fill("白方");
    await guest.locator('#join-form button[type="submit"]').click();
    await expect(page.locator("#turn-detail")).toContainText("輪到你落子");
    await page.locator("#reversi-3d-toggle").click();
    await expect(page.locator("#reversi-3d-scene canvas")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(guest.locator("#score-info")).toHaveText("黑 4 子 · 白 1 子");
    await page.reload();
    await expect(page.locator("#room-code")).toHaveText(code);
    await expect(page.locator("#reversi-3d-scene canvas")).toBeVisible();
    await expect(page.locator("#score-info")).toHaveText("黑 4 子 · 白 1 子");
    await guest.locator("#board .cell.legal").first().click();
    await expect(page.locator("#move-count")).toHaveText("2 手");
    await expect(guest.locator("#move-count")).toHaveText("2 手");
    await expect(page.locator("#score-info")).toHaveText("黑 3 子 · 白 3 子");
    await expect(guest.locator("#score-info")).toHaveText("黑 3 子 · 白 3 子");
  } finally {
    await context.close();
  }
});

test("reversi falls back to playable 2D without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/");
  await page.locator('[data-game="reversi"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#reversi-3d-toggle").click();
  await expect(page.locator("#reversi-3d-scene")).toBeHidden();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await page.locator("#board .cell.legal").first().click();
  await expect(page.locator("#score-info")).toHaveText("黑 4 子 · 白 1 子");
});

for (const game of ["chess", "go", "reversi"] as const) {
  test(`${game} 3D caps mobile resolution, stays idle and recovers context loss`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const request = window.requestAnimationFrame.bind(window);
        Object.assign(window, { testFrames: 0 });
        window.requestAnimationFrame = (callback) => {
          const counter = window as unknown as Window & { testFrames: number };
          counter.testFrames++;
          return request(callback);
        };
      });
      await page.goto("/");
      await page.locator(`[data-game="${game}"]`).click();
      await page.locator('[data-mode="local"]').click();
      if (game === "go") await page.locator("#board-size").selectOption("19");
      await page.locator("#start-button").click();
      await page.locator(`#${game}-3d-toggle`).click();
      const canvas = page.locator(`#${game}-3d-scene canvas`);
      await expect(canvas).toBeVisible();
      const resolution = await canvas.evaluate((element: HTMLCanvasElement) =>
        Math.max(element.width, element.height),
      );
      expect(resolution).toBeLessThanOrEqual(1200);
      const before = await page.evaluate(
        () => (window as unknown as Window & { testFrames: number }).testFrames,
      );
      await page.waitForTimeout(400);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as Window & { testFrames: number }).testFrames,
        ),
      ).toBe(before);
      if (game === "chess") {
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("ArrowUp");
        await page.keyboard.press("Enter");
      } else await page.keyboard.press("Enter");
      await expect(page.locator("#move-count")).toHaveText("1 手");
      expect(
        await page.evaluate(
          () =>
            (window as unknown as Window & { testFrames: number }).testFrames,
        ),
      ).toBe(before);
      await canvas.dispatchEvent("webglcontextlost");
      await expect(page.locator(".board-wrap")).toBeVisible();
      await expect(page.locator(`#${game}-3d-scene canvas`)).toHaveCount(0);
      await expect(page.locator("#table-figures-toggle")).toBeHidden();
    } finally {
      await context.close();
    }
  });
}
