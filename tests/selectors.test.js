/* ==========================================================================
   只读数据层单元测试

   这些函数不碰 DOM、不读全局 state，所以可以直接在 Node 里跑：
     node tests/selectors.test.js
   ========================================================================== */

const S = require('../js/selectors.js');

let pass = 0;
let fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass += 1; return; }
  fail += 1;
  failures.push(`${label}\n    期望 ${b}\n    实际 ${a}`);
}

function ok(cond, label) {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(label);
}

/* 固定的价位表：规模 → 股价（只为测试，不追求与真实卡面一致） */
const price = (size) => size * 100;

function makePlayers(spec) {
  return spec.map((stocks, i) => ({ name: `玩家${i + 1}`, cash: 1000 * (i + 1), stocks }));
}

/* ---------------------------------------------------------------- companySize */

{
  const board = { '0,0': 'a', '1,0': 'a', '2,0': 'b', '3,0': null };
  eq(S.companySize(board, 'a'), 2, 'companySize：数 a 的块');
  eq(S.companySize(board, 'b'), 1, 'companySize：数 b 的块');
  eq(S.companySize(board, 'c'), 0, 'companySize：不存在返回 0');
  eq(S.companySize({}, 'a'), 0, 'companySize：空棋盘');
  eq(S.companySize(null, 'a'), 0, 'companySize：null 棋盘不炸');
}

/* ---------------------------------------------------------------- holdersOf */

{
  const players = makePlayers([{ a: 5 }, { a: 9 }, { a: 0 }, {}]);
  const h = S.holdersOf(players, 'a');
  eq(h.map((x) => x.player), [1, 0], 'holdersOf：按股数降序，只含有股的');
  eq(h[0].count, 9, 'holdersOf：第一位是 9 张');
  eq(h[0].name, '玩家2', 'holdersOf：带名字');
}

{
  // 同股数按座位顺序，保证多次调用结果一致
  const players = makePlayers([{ a: 4 }, { a: 4 }, { a: 4 }]);
  eq(S.holdersOf(players, 'a').map((x) => x.player), [0, 1, 2], 'holdersOf：并列时按座位顺序');
}

{
  eq(S.holdersOf([], 'a'), [], 'holdersOf：空玩家列表');
  eq(S.holdersOf(makePlayers([{ a: 0 }]), 'a'), [], 'holdersOf：0 股不计入');
}

/* ---------------------------------------------------------------- groupHolders */

{
  const players = makePlayers([{ a: 7 }, { a: 7 }, { a: 5 }, { a: 0 }, { a: 5 }]);
  const g = S.groupHolders(players, 'a');
  eq(g.length, 2, 'groupHolders：7/7/5/5 分两组');
  eq(g[0].length, 2, 'groupHolders：第一组 2 人并列');
  eq(g[1].length, 2, 'groupHolders：第二组 2 人并列');
  eq(g[0][0].count, 7, 'groupHolders：第一组是 7 张');
  eq(g[1][0].count, 5, 'groupHolders：第二组是 5 张');
}

{
  const g = S.groupHolders(makePlayers([{ a: 3 }, { a: 2 }, { a: 1 }]), 'a');
  eq(g.length, 3, 'groupHolders：3/2/1 三组各自一人');
  eq(g.map((x) => x.length), [1, 1, 1], 'groupHolders：每组人数都是 1');
}

{
  eq(S.groupHolders(makePlayers([{ a: 0 }]), 'a'), [], 'groupHolders：无人持股返回空数组');
}

/* ---------------------------------------------------------------- playerHoldings */

{
  const p = { stocks: { a: 3, b: 0, c: 2 } };
  const h = S.playerHoldings(p);
  eq(h.length, 2, 'playerHoldings：只列数量 > 0 的');
  ok(h.some((x) => x.companyId === 'a' && x.count === 3), 'playerHoldings：含 a=3');
  eq(S.playerHoldings({}), [], 'playerHoldings：没有 stocks 返回空');
  eq(S.playerHoldings(null), [], 'playerHoldings：null 不炸');
}

/* ---------------------------------------------------------------- 市值 */

{
  // a 公司 3 块、b 公司 1 块（未成立）
  const board = { '0,0': 'a', '1,0': 'a', '2,0': 'a', '5,0': 'b' };
  const players = makePlayers([{ a: 2, b: 9 }, {}]);
  // a: 2 张 × 300 = 600；b 规模 1 不成立，按 0 计
  eq(S.playerStockValue(board, players, 0, price), 600, 'playerStockValue：成立公司计价，未成立按 0');
  eq(S.playerStockValue(board, players, 1, price), 0, 'playerStockValue：没股票为 0');
  eq(S.playerStockValue(board, players, 99, price), 0, 'playerStockValue：越界玩家为 0');
}

/* ---------------------------------------------------------------- 净资产 */

{
  const board = { '0,0': 'a', '1,0': 'a' };
  const players = makePlayers([{ a: 4 }, {}]);   // 玩家1 现金 1000，玩家2 现金 2000
  // a 规模 2 → price 200 → 4×200=800
  eq(S.playerNetWorth(board, players, 0, price), 1800, 'netWorth：现金 + 持股');
  eq(S.playerNetWorth(board, players, 1, price), 2000, 'netWorth：没持股就是现金');
}

/* ---------------------------------------------------------------- 排行榜 */

{
  const board = { '0,0': 'a', '1,0': 'a' };
  // 现金：1000 / 2000 / 3000；玩家1 另持 4 张 a（800）
  const players = makePlayers([{ a: 4 }, {}, { a: 1 }]);
  const list = S.standings(board, players, price);

  // 净资产：玩家3 = 3000+200 = 3200；玩家2 = 2000；玩家1 = 1000+800 = 1800
  eq(list.map((x) => x.player), [2, 1, 0], 'standings：按净资产降序（3200 / 2000 / 1800）');
  eq(list.map((x) => x.rank), [1, 2, 3], 'standings：名次连续');
}

{
  // 并列检查
  const board = {};
  const players = [
    { name: 'A', cash: 100, stocks: {} },
    { name: 'B', cash: 100, stocks: {} },
    { name: 'C', cash: 300, stocks: {} },
  ];
  const list = S.standings(board, players, price);
  eq(list.map((x) => x.name), ['C', 'A', 'B'], 'standings：并列时按座位顺序');
  eq(list.map((x) => x.rank), [1, 2, 2], 'standings：并列同名次');
}

/* ---------------------------------------------------------------- 公司概况 */

{
  const board = { '0,0': 'a', '1,0': 'a', '2,0': 'a' };
  const players = makePlayers([{ a: 6 }, { a: 4 }, { a: 0 }]);
  const s = S.companySummary(board, players, 'a', price, 11);

  eq(s.size, 3, 'summary：规模 3');
  eq(s.active, true, 'summary：已成立');
  eq(s.safe, false, 'summary：未达安全规模');
  eq(s.price, 300, 'summary：股价取当前规模');
  eq(s.totalShares, 10, 'summary：场上共 10 张');
  eq(s.topHolder.player, 0, 'summary：最大股东是玩家1');
  eq(s.holders.length, 2, 'summary：两人持股');
}

{
  const board = {};
  const s = S.companySummary(board, makePlayers([{}, {}]), 'a', price, 11);
  eq(s.size, 0, 'summary：未上市规模 0');
  eq(s.active, false, 'summary：未成立');
  eq(s.price, 0, 'summary：未成立不算价');
  eq(s.topHolder, null, 'summary：没有最大股东');
}

/* ---------------------------------------------------------------- 只读性 */

{
  const board = { '0,0': 'a' };
  const players = makePlayers([{ a: 2 }, { a: 1 }]);
  const snapshot = JSON.stringify({ board, players });

  S.companySize(board, 'a');
  S.holdersOf(players, 'a');
  S.groupHolders(players, 'a');
  S.standings(board, players, price);
  S.companySummary(board, players, 'a', price, 11);

  eq(JSON.stringify({ board, players }) === snapshot, true, '所有函数都不修改传入数据');
}

/* ------------------------------------------------------------ 创始人奖励 */

eq(S.founderReward(10, 25, 400), { stock: 1, cash: 0 }, '股票池有货 → 拿 1 张创始人股票');
eq(S.founderReward(25, 25, 600), { stock: 0, cash: 600 }, '25 张售罄 → 改为等值现金');

eq(
  S.firstUnplayable([[1, 1], [0, 0]], (c, r) => !(c === 0 && r === 0)),
  1,
  '找出第一块放不出去的牌'
);
eq(S.firstUnplayable([[1, 1]], () => true), -1, '全都能放时返回 -1');

/* ---------------------------------------------------------------- 输出 */

console.log('');
failures.forEach((f) => console.log('  ✗ ' + f));
if (failures.length) console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46));
if (fail > 0) process.exitCode = 1;
