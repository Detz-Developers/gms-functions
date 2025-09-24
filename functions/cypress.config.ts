import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5000", // optional if testing locally
    supportFile: "cypress/support/index.ts",
    specPattern: "cypress/e2e/**/*.cy.{js,ts}",
  },
  video: false,
});
