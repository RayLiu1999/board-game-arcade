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
