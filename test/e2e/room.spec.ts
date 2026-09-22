import { expect, test } from "@playwright/test";

test("players can create a room, join it, and make a move", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.locator("#invite-button").click();
  await expect(page.locator("#setup-dialog")).toBeVisible();
  await page.locator('[data-mode="online"]').click();
  await page.locator('[data-mode="rated"]').click();
  await page.locator("#player-name").fill("房主");
  await page.locator("#start-button").click();

  await expect(page.locator("#play-screen")).toBeVisible();
  await expect(page.locator("#mode-badge")).toContainText("競技對局");
  await expect(page.locator("#room-info")).toBeVisible();
  const code = (await page.locator("#room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-F0-9]{6}$/);
  await expect(page.locator("#turn-detail")).toContainText(
    "將房間連結分享給朋友",
  );

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto("/");
  await guest.locator("#header-join").click();
  await guest.locator("#join-code").fill(code);
  await guest.locator("#join-name").fill("好友");
  await guest.locator('#join-form button[type="submit"]').click();

  await expect(guest.locator("#play-screen")).toBeVisible();
  await expect(guest.locator("#room-code")).toHaveText(code);
  await expect(page.locator("#turn-detail")).toContainText("輪到你落子");
  await expect(guest.locator("#turn-detail")).toContainText("等待對手落子");

  await expect(page.locator("#chat-panel")).toBeVisible();
  await expect(guest.locator("#chat-panel")).toBeVisible();
  await page.locator("#chat-input").fill("你好 🀄");
  await page.locator('#chat-form button[type="submit"]').click();
  await expect(guest.locator("#chat-messages")).toContainText("你好 🀄");
  await expect(guest.locator("#chat-messages")).toContainText("房主");

  await guest.locator('#chat-emoji button[aria-label="鼓掌"]').click();
  await expect(guest.locator("#chat-input")).toHaveValue("👏");
  await guest.locator('#chat-form button[type="submit"]').click();
  await expect(page.locator("#chat-messages")).toContainText("👏");

  await page.locator('#board .cell[data-cell="52"]').click();
  await expect(page.locator('#board .cell[data-cell="36"]')).toHaveClass(
    /legal/,
  );
  await page.locator('#board .cell[data-cell="36"]').click();

  await expect(page.locator("#move-count")).toHaveText("1 手");
  await expect(guest.locator("#move-count")).toHaveText("1 手");
  await expect(
    guest.locator('#board .cell[data-cell="36"] .piece'),
  ).toBeVisible();

  await guest.close();
  await guestContext.close();
});

test("players can find each other through public matchmaking", async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await Promise.all([first.goto("/"), second.goto("/")]);
    for (const [page, name] of [
      [first, "配對甲"],
      [second, "配對乙"],
    ] as const) {
      await page.locator("#quick-play").click();
      await page.locator('[data-mode="matchmaking"]').click();
      await page.locator("#matchmaking-mode").selectOption("casual");
      await page.locator("#player-name").fill(name);
      await page.locator("#start-button").click();
    }
    await expect(first.locator("#play-screen")).toBeVisible();
    await expect(second.locator("#play-screen")).toBeVisible();
    await expect(first.locator("#mode-badge")).toContainText("公開配對");
    await expect(second.locator("#mode-badge")).toContainText("公開配對");
    await expect(first.locator("#turn-detail")).toContainText("輪到你落子");
    await expect(second.locator("#turn-detail")).toContainText("等待對手落子");
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
