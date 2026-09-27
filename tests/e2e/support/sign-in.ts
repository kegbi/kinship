import { expect, type Page } from "@playwright/test";
import { password } from "./env.ts";
import { settleNavigation } from "./navigation.ts";

/*
 * Sign-in through the UI. Each helper submits the sign-in form with the
 * shared test password and waits for the app-driven navigation it expects.
 */

/** Submits the sign-in form and waits for the URL to reach Today. */
export async function submitSignIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/**
 * Signs in and waits for Today's document to finish loading, so the spec may
 * navigate on its own next (REL-042).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await submitSignIn(page, email);
  await settleNavigation(page);
}

/**
 * Signs in and, when the server first routes to the compliance page, accepts
 * the required legal version. With `expectToday`, it then also waits for the
 * URL to reach Today.
 */
export async function signInAcceptingCompliance(
  page: Page,
  email: string,
  options: { readonly expectToday?: boolean } = {},
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app(?:$|\/compliance)/);
  if (new URL(page.url()).pathname === "/app/compliance") {
    await page.getByLabel("I have reviewed and accept this exact version.")
      .check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    if (options.expectToday) await expect(page).toHaveURL(/\/app$/);
  }
}
