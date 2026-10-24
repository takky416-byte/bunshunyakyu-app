import { test as base, expect } from '@playwright/test'

// Existing flow tests cover the user's immediate progression preference.
// announcements.spec.ts exercises the default presentation separately.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('geneki-draft:presentation:v1', 'off')
      sessionStorage.setItem('geneki-draft:welcome:v1', 'seen')
    })
    await use(page)
  },
})
export { expect }
