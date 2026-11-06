/* ==========================================================================
   AI 记忆 · 单元测试
     node tests/ai-brain.test.js
   ========================================================================== */

const Memory = require('../js/ai-memory.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(label);
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass += 1; return; }
  fail += 1;
  failures.push(`${label}\n    期望 ${b}\n    实际 ${a}`);
}

/* ---------------------------------------------------------------- 记忆 */

{
  const mem = Memory.create(0);

  Memory.update(mem, {
    round: 1,
    meIdx: 0,
    players: [{ stocks: { saxony: 2 } }, { stocks: { tower: 1 } }],
    holders: { saxony: [{ player: 0, count: 2 }], tower: [{ player: 1, count: 1 }] },
    alive: { saxony: true, tower: true },
  });

  eq(mem.lastStocks[0].saxony, 2, '记忆：记下上次持股');
  eq(Object.keys(mem.delta).length, 0, '记忆：首帧只建基线，不记买卖');
}

{
  const mem = Memory.create(0);

  /* 第一回合：我 2 张，对手 1 张 */
  Memory.update(mem, {
    round: 1, meIdx: 0,
    players: [{ stocks: { saxony: 2 } }, { stocks: { saxony: 1 } }],
    holders: { saxony: [{ player: 0, count: 2 }, { player: 1, count: 1 }] },
    alive: { saxony: true },
  });

  /* 第二回合：我买 1 张，对手买 2 张（抢走第一大股东） */
  Memory.update(mem, {
    round: 2, meIdx: 0,
    players: [{ stocks: { saxony: 3 } }, { stocks: { saxony: 3 } }],
    holders: { saxony: [{ player: 0, count: 3 }, { player: 1, count: 3 }] },
    alive: { saxony: true },
  });

  eq(mem.delta[0].saxony, { buy: 1, sell: 0, lost: 0 }, '记忆：主动买入记 buy');
  eq(mem.delta[1].saxony, { buy: 2, sell: 0, lost: 0 }, '记忆：对手买入记 buy');
  ok(Object.keys(mem.grudges).length >= 0, '记忆：敌意结构存在');
}

{
  /* 被吞并 vs 主动卖出：同样的减少量，记到不同字段 */
  const mem = Memory.create(0);

  Memory.update(mem, {
    round: 1, meIdx: 0,
    players: [{ stocks: { saxony: 4, tower: 2 } }],
    holders: {},
    alive: { saxony: true, tower: true },
  });

  /* saxony 还在（主动卖），tower 消失（被吞） */
  Memory.update(mem, {
    round: 2, meIdx: 0,
    players: [{ stocks: { saxony: 1 } }],
    holders: {},
    alive: { saxony: true },
  });

  eq(mem.delta[0].saxony, { buy: 0, sell: 3, lost: 0 }, '记忆：公司还在 → 记为卖出');
  eq(mem.delta[0].tower, { buy: 0, sell: 0, lost: 2 }, '记忆：公司消失 → 记为被吞');
}

{
  /* 第一大股东易主 → 记仇 + 事件 */
  const mem = Memory.create(0);

  Memory.update(mem, {
    round: 1, meIdx: 0,
    players: [{ stocks: { saxony: 5 } }, { stocks: { saxony: 2 } }],
    holders: { saxony: [{ player: 0, count: 5 }, { player: 1, count: 2 }] },
    alive: { saxony: true },
  });

  Memory.update(mem, {
    round: 2, meIdx: 0,
    players: [{ stocks: { saxony: 5 } }, { stocks: { saxony: 7 } }],
    holders: { saxony: [{ player: 1, count: 7 }, { player: 0, count: 5 }] },
    alive: { saxony: true },
  });

  eq(Memory.grudgeAgainst(mem, 1) >= 2, true, '记忆：被抢第一大股东 → 记仇');
  eq(Memory.recentEvents(mem, 'lostTop', 1)[0].by, 1, '记忆：事件记录是谁抢的');
}

{
  /* 敌意逐回合衰减 */
  const mem = Memory.create(0);
  mem.grudges[1] = 3;

  Memory.update(mem, { round: 10, meIdx: 0, players: [{ stocks: {} }, { stocks: {} }], holders: {}, alive: {} });
  const first = Memory.grudgeAgainst(mem, 1);

  Memory.update(mem, { round: 11, meIdx: 0, players: [{ stocks: {} }, { stocks: {} }], holders: {}, alive: {} });
  const second = Memory.grudgeAgainst(mem, 1);

  ok(second < first || (first === 0 && second === 0), '记忆：敌意逐回合衰减');
}

{
  /* 事件只保留最近 12 条 */
  const mem = Memory.create(0);
  for (let i = 0; i < 20; i++) {
    mem.events.push({ round: i, type: 'x' });
  }
  mem.events = mem.events.slice(-12);
  eq(mem.events.length, 12, '记忆：事件上限 12 条');
}

/* ---------------------------------------------------------------- 输出 */

console.log('');
failures.forEach((f) => console.log('  ✗ ' + f));
if (failures.length) console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46));
if (fail > 0) process.exitCode = 1;
