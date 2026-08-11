import path from 'node:path';
import { expect, test } from '@playwright/test';

test('업로드부터 분할·삭제·FFmpeg 내보내기까지 완료한다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const media = path.resolve('..', 'school_31_event_3.mp4');
  await page.locator('input[type="file"]').setInputFiles(media);
  await expect(page.locator('.timeline-clip')).toHaveCount(1);

  await page.locator('.timeline-scroll').click({ position: { x: 80, y: 12 } });
  await page.getByRole('button', { name: '분할' }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(2);

  await page.locator('.timeline-clip').nth(1).click({ position: { x: 12, y: 20 } });
  await page.getByRole('button', { name: '삭제' }).click();
  await expect(page.locator('.timeline-clip')).toHaveCount(1);

  await page.getByRole('button', { name: '내보내기' }).click();
  await page.getByLabel('품질').selectOption('draft');
  await page.getByRole('button', { name: '렌더링 시작' }).click();

  await expect(page.getByText('내보내기 완료')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('link', { name: '파일 다운로드' })).toHaveAttribute(
    'href',
    /\/api\/exports\/.+\/download/,
  );
});
