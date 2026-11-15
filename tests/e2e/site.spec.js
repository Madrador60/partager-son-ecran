const { test, expect } = require("@playwright/test");

test("accueil, téléchargement et version web", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Aidez vos proches à distance");
  await expect(page.locator("#downloadButton")).toHaveAttribute("href", /api\/download\/latest\/windows|github\.com\/Madrador60\/partager-son-ecran\/releases/);

  await page.goto("/remote.html");
  await expect(page.getByRole("heading", { name: "Que voulez-vous faire ?" })).toBeVisible();
  await expect(page.getByText("Serveur connecté")).toBeVisible();

  await page.getByRole("button", { name: /Montrer mon écran/ }).click();
  await expect(page.getByRole("heading", { name: "Montrer mon écran" })).toBeVisible();
  await expect(page.getByLabel("Validité du code")).toHaveValue("0");
  await expect(page.getByRole("button", { name: /Générer mon code/ })).toBeDisabled();

  await page.getByRole("button", { name: "Retour" }).first().click();
  await page.getByRole("button", { name: /Aider quelqu’un/ }).click();
  await expect(page.getByRole("heading", { name: "Aider quelqu’un" })).toBeVisible();
  await page.getByLabel("Code de connexion").fill("123456789");
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.getByText("Connexion impossible")).toBeVisible();
  expect(errors).toEqual([]);
});
