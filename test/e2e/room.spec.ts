import { expect, test } from "@playwright/test";

test("players can create a room, join it, and make a move", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#invite-button").click();
  await expect(page.locator("#setup-dialog")).toBeVisible();
  await page.locator('[data-mode="online"]').click();
  await page.locator("#player-name").fill("房主");
  await page.locator("#start-button").click();

  await expect(page.locator("#play-screen")).toBeVisible();
  await expect(page.locator("#room-info")).toBeVisible();
  const code = (await page.locator("#room-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-F0-9]{6}$/);
  await expect(page.locator("#turn-detail")).toContainText(
    "將房間連結分享給朋友",
  );

  const guest = await page.context().newPage();
  await guest.goto("/");
  await guest.locator("#header-join").click();
  await guest.locator("#join-code").fill(code);
  await guest.locator("#join-name").fill("好友");
  await guest.locator('#join-form button[type="submit"]').click();

  await expect(guest.locator("#play-screen")).toBeVisible();
  await expect(guest.locator("#room-code")).toHaveText(code);
  await expect(page.locator("#turn-detail")).toContainText("輪到你落子");
  await expect(guest.locator("#turn-detail")).toContainText("等待對手落子");

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
});
