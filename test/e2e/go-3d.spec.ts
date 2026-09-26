import { expect, test } from "@playwright/test";

for (const [size, center, coordinate] of [
  [9, 40, "E5"],
  [13, 84, "G7"],
  [19, 180, "K10"],
] as const) {
  test(`3D go supports ${String(size)} lines and the same board move`, async ({
    page,
  }) => {
    const sceneRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/go-3d.js"))
        sceneRequests.push(request.url());
    });
    await page.goto("/");
    await page.locator('[data-game="go"]').click();
    await page.locator('[data-mode="local"]').click();
    await page.locator("#board-size").selectOption(String(size));
    await page.locator("#start-button").click();
    expect(sceneRequests).toHaveLength(0);

    await page.locator("#go-3d-toggle").click();
    await expect(page.locator("#go-3d-scene canvas")).toBeVisible();
    expect(sceneRequests).toHaveLength(1);
    await expect(page.locator("#go-3d-coordinate")).toHaveText(coordinate);
    await expect(page.locator(".board-wrap")).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(page.locator("#move-count")).toHaveText("1 手");
    await expect(
      page.locator(`#board [data-cell="${String(center)}"] .piece`),
    ).toBeAttached();

    await page.locator("#go-3d-toggle").click();
    await expect(page.locator(".board-wrap")).toBeVisible();
    await expect(
      page.locator(`#board [data-cell="${String(center)}"]`),
    ).toHaveAttribute("tabindex", "0");
  });
}

test("phone can place a go stone by touching its 3D intersection", async ({
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
    await page.locator('[data-game="go"]').click();
    await page.locator('[data-mode="local"]').click();
    await page.locator("#start-button").click();
    await page.locator("#go-3d-toggle").click();
    const canvas = page.locator("#go-3d-scene canvas");
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    await canvas.tap({
      position: { x: bounds.width / 2, y: bounds.height / 2 },
    });
    await expect(page.locator("#move-count")).toHaveText("1 手");
    await expect(page.locator('#board [data-cell="40"] .piece')).toBeAttached();
  } finally {
    await context.close();
  }
});

test("phone previews a 19-line intersection before placing a stone", async ({
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
    await page.locator('[data-game="go"]').click();
    await page.locator('[data-mode="local"]').click();
    await page.locator("#board-size").selectOption("19");
    await page.locator("#start-button").click();
    await page.locator("#go-3d-toggle").click();
    const canvas = page.locator("#go-3d-scene canvas");
    await expect(canvas).toBeVisible();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    await canvas.tap({ position: center });
    await expect(page.locator("#go-3d-coordinate")).toHaveText("K10");
    await expect(page.locator("#go-3d-touch-hint")).toHaveText("再點一次確認");
    await expect(page.locator("#move-count")).toHaveText("0 手");
    await canvas.tap({ position: center });
    await expect(page.locator("#move-count")).toHaveText("1 手");
    await expect(
      page.locator('#board [data-cell="180"] .piece'),
    ).toBeAttached();
  } finally {
    await context.close();
  }
});

test("go restores its chosen view and board size after resuming", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="go"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#board-size").selectOption("13");
  await page.locator("#start-button").click();
  await page.locator("#go-3d-toggle").click();
  await expect(page.locator("#go-3d-scene canvas")).toBeVisible();

  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator("#go-3d-scene canvas")).toBeVisible();
  await expect(page.locator("#go-3d-coordinate")).toHaveText("G7");
  await page.locator("#go-3d-toggle").click();
  await page.reload();
  await page.locator("#resume-save").click();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator("#go-3d-scene")).toBeHidden();
});

test("3D go syncs an online move and restores after rejoining", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.locator('[data-game="go"]').click();
  await page.locator('[data-mode="online"]').click();
  await page.locator("#player-name").fill("黑方");
  await page.locator("#board-size").selectOption("9");
  await page.locator("#start-button").click();
  await expect(page.locator("#room-code")).toBeVisible();
  const code = (await page.locator("#room-code").textContent())?.trim() ?? "";

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.locator("#header-join").click();
    await guest.locator("#join-code").fill(code);
    await guest.locator("#join-name").fill("白方");
    await guest.locator('#join-form button[type="submit"]').click();
    await expect(page.locator("#turn-detail")).toContainText("輪到你落子");

    await page.locator("#go-3d-toggle").click();
    await expect(page.locator("#go-3d-scene canvas")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(guest.locator('#board [data-cell="40"] .stone')).toBeVisible();
    await page.reload();
    await expect(page.locator("#room-code")).toHaveText(code);
    await expect(page.locator("#go-3d-scene canvas")).toBeVisible();
    await expect(page.locator('#board [data-cell="40"] .stone')).toBeAttached();
  } finally {
    await guestContext.close();
  }
});

test("3D go keeps scoring actions in the authoritative board", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="go"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#go-3d-toggle").click();
  await expect(page.locator("#go-3d-scene canvas")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.locator("#pass-button").click();
  await page.locator("#pass-button").click();
  await expect(page.locator("#accept-score")).toBeVisible();
  await page.locator("#go-3d-scene").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('#board [data-cell="40"] .stone')).toHaveClass(
    /dead/,
  );
});

test("3D go reflects captured stones from the game engine", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-game="go"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#go-3d-toggle").click();
  await expect(page.locator("#go-3d-scene canvas")).toBeVisible();

  let row = 4;
  let column = 4;
  for (const [targetRow, targetColumn] of [
    [4, 3],
    [4, 4],
    [4, 5],
    [8, 0],
    [3, 4],
    [7, 0],
    [5, 4],
  ] as const) {
    while (row > targetRow) {
      await page.keyboard.press("ArrowUp");
      row--;
    }
    while (row < targetRow) {
      await page.keyboard.press("ArrowDown");
      row++;
    }
    while (column > targetColumn) {
      await page.keyboard.press("ArrowLeft");
      column--;
    }
    while (column < targetColumn) {
      await page.keyboard.press("ArrowRight");
      column++;
    }
    await page.keyboard.press("Enter");
  }
  await expect(page.locator("#move-count")).toHaveText("7 手");
  await expect(page.locator('#board [data-cell="40"] .stone')).toHaveCount(0);
  await page.locator("#go-3d-toggle").click();
  await expect(page.locator('#board [data-cell="40"]')).toHaveAttribute(
    "aria-label",
    /E5 空位/,
  );
});

test("go restores 2D when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/");
  await page.locator('[data-game="go"]').click();
  await page.locator('[data-mode="local"]').click();
  await page.locator("#start-button").click();
  await page.locator("#go-3d-toggle").click();
  await expect(page.locator("#go-3d-scene")).toBeHidden();
  await expect(page.locator(".board-wrap")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("無法載入 3D 棋盤");
  expect(await page.evaluate(() => localStorage.getItem("qiju-go-view"))).toBe(
    '"2d"',
  );
  await page.locator('#board [data-cell="40"]').click();
  await expect(page.locator("#move-count")).toHaveText("1 手");
});
