import { expect, test, type Page } from './fixtures';

const startupGamepads = (page: Page) =>
  page.evaluate(() => (window as Window & { __startupGamepads?: string[] }).__startupGamepads);

test('controller isolation precedes page startup and survives reloads and new pages', async ({ page, context }) => {
  // Model a connected controller at the browser API boundary. The context's own
  // navigator override must hide it before even the first application script reads input.
  await context.route('**/controller-probe', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<script>
      Navigator.prototype.getGamepads = () => [{ id: 'connected physical controller' }];
      window.__startupGamepads = Array.from(navigator.getGamepads(), (pad) => pad.id);
    </script>`,
  }));

  await page.goto('/controller-probe');
  expect(await startupGamepads(page)).toEqual([]);
  await page.reload();
  expect(await startupGamepads(page)).toEqual([]);

  const secondPage = await context.newPage();
  await secondPage.goto('/controller-probe');
  expect(await startupGamepads(secondPage)).toEqual([]);
  await secondPage.close();
});
