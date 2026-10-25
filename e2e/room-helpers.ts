import { expect, type Page } from '@playwright/test'
import { ROOM_SESSION_KEY, type RoomSnapshot } from '../src/room-contract'
import { teamById, type TeamId } from '../src/data'
export async function roomSnapshot(page: Page): Promise<RoomSnapshot> {
  return page.evaluate(async (key) => {
    const session = JSON.parse(localStorage.getItem(key)!)
    const response = await fetch(`/api/rooms/${session.code}`, {
      headers: { Authorization: 'Bearer ' + session.token },
    })
    if (!response.ok)
      throw new Error('Cannot read room state: ' + response.status)
    return response.json()
  }, ROOM_SESSION_KEY)
}
export async function createRoom(page: Page, team?: TeamId, name = 'テストGM') {
  await page.getByLabel('プレーヤー名', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'ルームを作る', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'ルームの待合室' }),
  ).toBeVisible()
  if (team)
    await page
      .getByRole('button', { name: teamById[team].name, exact: true })
      .click()
  return (await roomSnapshot(page)).code
}
export async function startRoom(page: Page, team?: TeamId) {
  await createRoom(page, team ?? 't')
  await page
    .getByRole('button', { name: 'ドラフトを開始する', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: /提出候補を選ぶ/ }),
  ).toBeVisible()
}
export async function advanceToRoundTwo(page: Page) {
  for (let step = 0; step < 150; step++) {
    const state = await roomSnapshot(page),
      game = state.game!
    if (game.stage === 'round2' && !state.presentation) return
    if (
      game.stage === 'draft' &&
      game.current === game.userTeam &&
      !state.presentation
    ) {
      await page.getByRole('radio').first().check()
      await page
        .getByRole('button', { name: 'この選手を指名', exact: true })
        .click()
    } else await page.waitForTimeout(80)
  }
  throw new Error('Did not reach round two')
}
export async function finishRoom(
  page: Page,
  participate = false,
  balanced = false,
) {
  for (let step = 0; step < 250; step++) {
    const state = await roomSnapshot(page),
      game = state.game!
    if (game.stage === 'results' && !state.presentation) {
      await expect(
        page.getByRole('heading', { name: '12球団のドラフト結果' }),
      ).toBeVisible()
      return
    }
    if (state.presentation) {
      await page.waitForTimeout(80)
      continue
    }
    if (game.stage === 'draft' && game.current === game.userTeam) {
      await page.getByRole('radio').first().check()
      await page
        .getByRole('button', { name: 'この選手を指名', exact: true })
        .click()
    } else if (
      game.stage === 'round2' &&
      !state.submitted.includes(game.userTeam)
    ) {
      await page
        .getByRole('button', {
          name: participate ? '獲得希望で参加する' : '自球団は参加を見送る',
          exact: true,
        })
        .click()
    } else if (
      game.stage === 'round2confirm' &&
      !state.submitted.includes(game.userTeam)
    ) {
      if (await page.locator('.second-round-choices input').count()) {
        await page.locator('.second-round-choices input').first().check()
        if (balanced)
          await page.getByLabel('第2巡の入札条件').selectOption('balanced')
      }
      await page.getByRole('button', { name: '入札を確定する' }).click()
    } else await page.waitForTimeout(80)
  }
  throw new Error('Did not reach room results')
}
