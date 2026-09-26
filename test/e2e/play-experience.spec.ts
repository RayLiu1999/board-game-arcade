import { expect, test } from "@playwright/test";

test("table depth and keyboard board controls work during a local match", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();

  const playScreen = page.locator("#play-screen");
  const toggle = page.locator("#table-view-toggle");
  await expect(playScreen).toBeVisible();
  await expect(playScreen).toHaveAttribute("data-play-game", "chess");
  await expect(playScreen).toHaveClass(/table-depth/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#board")).toBeInViewport();
  await expect(toggle).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await toggle.click();
  await expect(playScreen).not.toHaveClass(/table-depth/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(playScreen).toHaveClass(/table-depth/);

  const source = page.locator('#board .cell[data-cell="52"]');
  await source.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('#board .cell[data-cell="44"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(source).toHaveClass(/selected/);
  await expect(source).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(source).not.toHaveClass(/selected/);
  await expect(source).toBeFocused();

  await page.keyboard.press("Enter");
  const destination = page.locator('#board .cell[data-cell="36"]');
  await expect(destination).toHaveClass(/legal/);
  await destination.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#move-count")).toHaveText("1 手");
  await expect(destination).toBeFocused();
});

test("phone match keeps controls visible and opens history on demand", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();

  await expect(page.locator("#turn-title")).toBeVisible();
  await expect(page.locator("#restart-button")).toBeVisible();
  await expect(page.locator("#history-panel")).toBeHidden();
  await expect(page.locator("#mobile-chat-toggle")).toBeHidden();
  const history = page.locator("#mobile-history-toggle");
  await expect(history).toHaveText("紀錄 · 0 手");
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#history-panel")).toBeVisible();
  await history.click();
  await expect(page.locator("#history-panel")).toBeHidden();

  await page.locator("#chess-3d-toggle").click();
  await expect(page.locator("#chess-3d-scene canvas")).toBeVisible();
  await expect(page.locator("#turn-title")).toBeVisible();
});

test("3D chess table shares the same moves as the 2D board", async ({
  page,
}) => {
  const sceneRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/chess-3d.js"))
      sceneRequests.push(request.url());
  });
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  expect(sceneRequests).toHaveLength(0);

  await page.locator("#chess-3d-toggle").click();
  const scene = page.locator("#chess-3d-scene");
  await expect(scene).toBeVisible();
  await expect(scene.locator("canvas")).toBeVisible();
  expect(sceneRequests).toHaveLength(1);
  await expect(page.locator(".board-wrap")).toBeHidden();
  await expect(scene).toBeFocused();
  await expect(page.locator("#chess-3d-coordinate")).toHaveText("E2");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(scene).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.keyboard.press("Enter");
  await expect(page.locator('#board [data-cell="52"]')).toHaveClass(/selected/);
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#chess-3d-coordinate")).toHaveText("E3");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#chess-3d-coordinate")).toHaveText("E4");
  await page.keyboard.press("Enter");
  await expect(page.locator("#move-count")).toHaveText("1 手");

  await page.locator("#chess-3d-toggle").click();
  await expect(scene).toBeHidden();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator('#board [data-cell="36"] .piece')).toBeVisible();
  await expect(page.locator('#board [data-cell="36"]')).toHaveAttribute(
    "tabindex",
    "0",
  );
});

test("chess restores the chosen view after resuming a saved match", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#chess-3d-toggle").click();
  await expect(page.locator("#chess-3d-scene canvas")).toBeVisible();
  await expect(page.locator("#chess-3d-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator("#chess-3d-scene canvas")).toBeVisible();
  await page.locator("#chess-3d-toggle").click();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator("#chess-3d-scene")).toBeHidden();
});

test("3D chess table accepts pointer moves on board squares", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#chess-3d-toggle").click();
  const canvas = page.locator("#chess-3d-scene canvas");
  await expect(canvas).toBeVisible();

  await canvas.click({ position: { x: 327, y: 406 } });
  await expect(page.locator('#board [data-cell="52"]')).toHaveClass(/selected/);
  await canvas.click({ position: { x: 323, y: 304 } });
  await expect(page.locator("#move-count")).toHaveText("1 手");
});

test("3D chess table accepts touch moves on a phone viewport", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.locator('[data-game="chess"]').click();
    await page.locator('[data-mode="local"]').click();
    await page.locator("#start-button").click();
    await page.locator("#chess-3d-toggle").click();
    const canvas = page.locator("#chess-3d-scene canvas");
    await expect(canvas).toBeVisible();

    await canvas.tap({ position: { x: 175, y: 217 } });
    await expect(page.locator('#board [data-cell="52"]')).toHaveClass(
      /selected/,
    );
    await canvas.tap({ position: { x: 173, y: 162 } });
    await expect(page.locator("#move-count")).toHaveText("1 手");
  } finally {
    await context.close();
  }
});

test("chess keeps the 2D board when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/");
  await page.locator('[data-game="chess"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#chess-3d-toggle").click();

  await expect(page.locator("#chess-3d-scene")).toBeHidden();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("無法載入 3D 棋盤");
  expect(
    await page.evaluate(() => localStorage.getItem("qiju-chess-view")),
  ).toBe('"2d"');
  await page.locator('#board [data-cell="52"]').click();
  await page.locator('#board [data-cell="36"]').click();
  await expect(page.locator("#move-count")).toHaveText("1 手");
});
