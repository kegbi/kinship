import { expect, test } from "@playwright/test";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test("public home reports live API readiness and degrades safely", async ({ page }) => {
  const policyViolations = recordPolicyViolations(page);
  await page.goto("/");

  await expect(page).toHaveTitle(/Kinship/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Relationships deserve a place",
  );
  const readiness = page.getByRole("status");
  await expect(readiness).toContainText("API ready");
  await expect(readiness).toHaveAttribute("data-state", "ready");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();

  await page.route("**/api/v1/health", (route) => route.abort());
  await page.reload();
  await expect(readiness).toContainText("API temporarily unavailable");
  await expect(readiness).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByRole("main")).toBeVisible();
  expect(policyViolations).toEqual([]);
});

test("public pages expose their catalog contracts and navigate both ways", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "public.home",
  );
  await expect(page).toHaveTitle("Kinship — Remember what matters");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /relationships grow/,
  );
  await expect(page.getByRole("link", { name: "Home", exact: true }))
    .toHaveAttribute(
      "aria-current",
      "page",
    );

  await page.getByRole("link", { name: "Features", exact: true }).press(
    "Enter",
  );
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "public.features",
  );
  await expect(page).toHaveTitle("Features — Kinship");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /relationship context/i,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Thoughtful tools for showing up.",
  );
  await expect(page.getByRole("link", { name: "Features", exact: true }))
    .toHaveAttribute(
      "aria-current",
      "page",
    );
  await expect(page.getByText("Available as Kinship grows")).toBeVisible();

  await page.getByRole("link", { name: "Home", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/$/);
});

test("public home exposes direct sign-in and registration entry points", async ({ page }) => {
  await page.goto("/");

  const header = page.getByRole("banner");
  const main = page.getByRole("main");
  const headerSignIn = header.getByRole("link", {
    name: "Sign in",
    exact: true,
  });
  const headerCreateAccount = header.getByRole("link", {
    name: "Create account",
    exact: true,
  });
  const heroSignIn = main.getByRole("link", { name: "Sign in", exact: true });
  const heroCreateAccount = main.getByRole("link", {
    name: "Create account",
    exact: true,
  });

  await expect(headerSignIn).toHaveAttribute("href", "/auth/sign-in");
  await expect(headerCreateAccount).toHaveAttribute("href", "/auth/sign-up");
  await expect(heroSignIn).toHaveAttribute("href", "/auth/sign-in");
  await expect(heroCreateAccount).toHaveAttribute("href", "/auth/sign-up");

  await headerSignIn.click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "auth.sign-in",
  );

  await page.goto("/");
  await main.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "auth.sign-up",
  );
});

test("public navigation and skip links have a coherent keyboard order", async ({ page }) => {
  await page.goto("/features");

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeVisible();

  await page.goto("/features");
  const orderedLinks = [
    skipLink,
    page.getByRole("link", { name: "Kinship home" }),
    page.getByRole("link", { name: "Home", exact: true }),
    page.getByRole("link", { name: "Features", exact: true }),
    page.getByRole("link", { name: "API", exact: true }),
    page.getByRole("link", { name: "Privacy", exact: true }),
    page.getByRole("link", { name: "Terms", exact: true }),
    page.getByRole("banner").getByRole("link", {
      name: "Sign in",
      exact: true,
    }),
    page.getByRole("banner").getByRole("link", {
      name: "Create account",
      exact: true,
    }),
  ];
  for (const link of orderedLinks) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
});

test("public pages remain usable at a representative mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Public" });
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("link", { name: "Home", exact: true }))
    .toBeInViewport();
  await expect(page.getByRole("link", { name: "Features", exact: true }))
    .toBeInViewport();
  await expect(page.getByRole("link", { name: "API", exact: true }))
    .toBeInViewport();
  expect(
    await page.getByRole("banner").locator("a").evaluateAll((links) =>
      links.filter((link) => {
        const bounds = link.getBoundingClientRect();
        return bounds.left < 0 || bounds.right > innerWidth;
      }).map((link) => link.textContent?.trim())
    ),
  ).toEqual([]);
  await expect(
    page.getByRole("banner").getByRole("link", {
      name: "Create account",
      exact: true,
    }),
  ).toBeInViewport();
  await expect(
    page.getByRole("main").getByRole("link", {
      name: "Create account",
      exact: true,
    }),
  ).toBeInViewport();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(
    () =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("ready and not-found public states pass representative accessibility scans", async ({ page }) => {
  await page.goto("/features");
  await expectAccessible(page, { networkIdle: true, runOnly: wcagTags });

  const response = await page.goto("/a-route-that-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found — Kinship");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "This path doesn’t lead anywhere yet.",
  );
  await expect(page.locator("body")).not.toHaveAttribute("data-page-id", /.+/);
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.getByRole("link", { name: "Explore features" }))
    .toHaveAttribute(
      "href",
      "/features",
    );
  await expectAccessible(page, { networkIdle: true, runOnly: wcagTags });
});
