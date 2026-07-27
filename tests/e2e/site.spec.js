const { test, expect } = require("@playwright/test");

test("accueil, téléchargement et interface distante", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Aidez un écran distant/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Télécharger pour Windows" })).toHaveAttribute("href", /api\/download\/latest\/windows/);

  await page.goto("/remote.html");
  await expect(page.getByRole("heading", { name: "Partager mon PC" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Se connecter à un PC" })).toBeVisible();
  await expect(page.getByText("Serveur connecté")).toBeVisible();

  await page.getByRole("button", { name: /Partager maintenant/ }).click();
  await expect(page.getByRole("heading", { name: "Partager mon écran" })).toBeVisible();
  await expect(page.getByLabel("Durée")).toHaveValue("0");

  await page.getByRole("button", { name: /Choisir un autre mode/ }).click();
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await expect(page.getByRole("heading", { name: "Se connecter à un appareil" })).toBeVisible();
  expect(errors).toEqual([]);
});
