import { retailUsdSale } from './parse.ts'

const pair = (sale: string, name = 'USD/UAH') => `<div class="pair"><div class="pair__name">${name}</div><ul>
  <li class="pair__block" data-title="Покупка"><div class="pair__block-retail"><div class="pair__block-num">45.00</div></div></li>
  <li class="pair__block" data-title="Продажа"><div class="pair__block-wholesale"><div class="pair__block-num">46.40</div></div><div class="pair__block-retail"><div class="pair__block-num">${sale}</div></div></li>
  </ul><div class="clear60"></div></div>`

Deno.test('extracts only retail USD sale from server HTML', () => {
  const html = pair('47,35', 'EUR/UAH') + pair('46.45')
  if (retailUsdSale(html) !== 46.45) throw new Error('Wrong USD sale rate')
})

Deno.test('rejects missing, duplicate and invalid sale values', () => {
  for (const html of [pair('46.40', 'EUR/UAH'), pair('46.40') + pair('46.40'), pair('0'), pair('abc'), pair('-1')]) {
    let rejected = false
    try { retailUsdSale(html) } catch { rejected = true }
    if (!rejected) throw new Error('Invalid HTML accepted')
  }
})
