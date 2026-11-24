// Home's Open folder and Examples in the quality journeys (the step after): the
// folder picker by the keyboard, the Examples entry's copy of the client example run in the built page, and Open
// folder moving the page to another folder's daemon after asking about the open notebooks.
import { mkdir, realpath, writeFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

import { homeSound, sound } from "./quality.js";
import type { World } from "./world.js";
import { expect, jsnbIn } from "./world.js";

/** The folder picker by the keyboard: it opens on the workspace folder, Down goes to the rows and into a folder, which
 * is inside the workspace open here (Open off), Backspace goes up, a path that names no folder says so in words, and
 * Esc closes it. */
export async function picker(page: Page, world: World): Promise<void> {
  await page.locator('[data-menu="File"]').click();
  await page.getByRole("menuitem", { name: "Open Folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Open Folder" });
  const field = dialog.getByTestId("folder-path");
  await expect(field).toBeFocused();
  const root = await realpath(world.dir);
  await expect(field).toHaveValue(root);
  await expect(dialog.getByTestId("folder-note")).toHaveText("Open here");
  await expect(dialog.getByTestId("open-folder")).toBeDisabled();
  await expect(dialog.getByTestId("recent-folders")).toContainText("open here");
  await field.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("option", { name: /^reports 1 notebook$/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue(`${root}/reports`);
  await expect(dialog.getByTestId("folder-note")).toHaveText("In the workspace open here");
  await homeSound(page, "Home, the folder picker");
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue(root);
  await field.fill(`${root}/nowhere`);
  await field.press("Enter");
  await expect(dialog.getByTestId("folder-error")).toHaveText(
    `There is no folder at ${root}/nowhere.`,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

/** File > New from Example copies the client example into the workspace and opens the copy; Run all runs its client
 * cells in the built page, none failing, and the layout holds. */
export async function clientExample(page: Page): Promise<void> {
  await page.locator('[data-menu="File"]').click();
  await page.getByRole("menuitem", { name: "New from Example" }).click();
  await page.getByRole("menuitem", { name: /^Client side: build a small interface/u }).click();
  await expect(page).toHaveURL(/\/ui\/02-client-ui\?token=/u);
  await expect(page.getByTestId("page-state")).toHaveAttribute("data-state", "attached");
  await page.getByRole("button", { name: "Run All", exact: true }).click();
  const states = page.getByTestId("run-fact");
  await expect(states.and(page.locator('[data-kind="ok"]'))).toHaveCount(5);
  await expect(states.and(page.locator('[data-kind="error"], [data-kind="notRun"]'))).toHaveCount(
    0,
  );
  await sound(page, "the client example after Run all");
}

/** Open folder from Home while notebooks are open: it asks in words first, then the page moves to the other folder's
 * own daemon and Home; that daemon is stopped at the end, as the world's own is. */
export async function otherFolder(page: Page, world: World): Promise<void> {
  const elsewhere = world.path("..", "elsewhere");
  await mkdir(elsewhere, { recursive: true });
  await writeFile(`${elsewhere}/notes.jsnb`, '{ "version": 1, "cells": [] }\n');
  await page.locator('[data-menu="File"]').click();
  await page.getByRole("menuitem", { name: "Go to Home" }).click();
  await page.locator('[data-menu="File"]').click();
  await page.getByRole("menuitem", { name: "Open Folder…" }).click();
  const dialog = page.getByRole("dialog", { name: "Open Folder" });
  await dialog.getByTestId("folder-path").fill("../elsewhere");
  await dialog.getByTestId("folder-path").press("Enter");
  await expect(dialog.getByTestId("folder-note")).toHaveText("1 notebook");
  await dialog.getByTestId("open-folder").click();
  await expect(dialog.getByTestId("folder-leaving")).toContainText("notebooks are open");
  await homeSound(page, "Home, asking before it leaves the open notebooks");
  await dialog.getByTestId("open-folder").click();
  try {
    await expect(page.getByTestId("place")).toHaveText("elsewhere");
    await expect(page.getByRole("option", { name: /^notes.jsnb /u })).toBeVisible();
    await homeSound(page, "Home of the other folder");
  } finally {
    await jsnbIn(elsewhere, world.env, ["stop"]).catch(() => undefined);
  }
}
