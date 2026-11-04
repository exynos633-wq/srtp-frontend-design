import type { Page } from '@playwright/test'

/** Open a secondary tool from More, in either renderer. */
export async function viewerMenuItem(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: '… 更多' })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
  return page.getByRole('menuitem', { name })
}
