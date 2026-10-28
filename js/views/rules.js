// Account-rule meters (daily loss limit, trailing drawdown), shared by Journal and Stats.

import { money, moneyPlain, esc } from '../format.js';

function meter({ title, used, limit, left, breached, foot }) {
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const level = breached ? 'over' : ratio >= 0.75 ? 'hot' : ratio >= 0.5 ? 'warm' : 'ok';
  return `
    <div class="rule rule-${level}">
      <div class="rule-head"><span>${esc(title)}</span>
        <span class="num">${breached ? 'Limit hit' : `${moneyPlain(left)} left`}</span></div>
      <div class="rule-track" role="meter" aria-label="${esc(title)}" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}">
        <div class="rule-fill" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
      <div class="rule-foot">${foot}</div>
    </div>`;
}

/** rules: result of calc.accountRules(). Renders whichever limits are set. */
export function rulesHtml({ daily, drawdown }, extraClass = '') {
  if (!daily && !drawdown) return '';
  return `
    <section class="card rules ${extraClass}" aria-label="Account limits">
      ${daily ? meter({
        title: 'Daily loss limit',
        ...daily,
        foot: `Today <span class="num">${money(daily.net)}</span> · limit <span class="num">${moneyPlain(daily.limit)}</span>`,
      }) : ''}
      ${drawdown ? meter({
        title: 'Trailing drawdown',
        ...drawdown,
        foot: `Balance <span class="num">${money(drawdown.balance)}</span> · floor <span class="num">${money(drawdown.floor)}</span>`,
      }) : ''}
    </section>`;
}
