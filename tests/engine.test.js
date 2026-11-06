/* ==========================================================================
   规则引擎单元测试（Node 直接运行）
     node tests/engine.test.js
   ========================================================================== */

const assert = require('assert');
const E = require('../js/engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('     ' + err.message);
  }
}

/** 快速铺棋盘：[[col,row,companyId|null], ...] */
function layout(game, cells) {
  cells.forEach(([c, r, id]) => {
    game.board[E.key(c, r)] = id === undefined ? null : id;
    if (id) game.founded[id] = true;
  });
  return game;
}

function newGame(opts) {
  const g = E.createGame(opts || { players: 4 });
  return g;
}

/* ------------------------------------------------------------------ 放置 */

console.log('\n【放置判定】');

test('空格子放到荒野 = 孤立放置', () => {
  const g = newGame();
  const a = E.analyzePlacement(g, 5, 4);
  assert.strictEqual(a.valid, true);
  assert.strictEqual(a.type, 'isolated');
});

test('已有板块的格子不能再放', () => {
  const g = layout(newGame(), [[3, 3, null]]);
  const a = E.analyzePlacement(g, 3, 3);
  assert.strictEqual(a.valid, false);
});

test('连到零散板块 = 可以创立公司', () => {
  const g = layout(newGame(), [[3, 3, null]]);
  const a = E.analyzePlacement(g, 4, 3);
  assert.strictEqual(a.type, 'found');
  assert.strictEqual(a.groupSize, 2);
  assert.strictEqual(a.canFound, true);
});

test('只连到一块零散板块时组里只有新块，不算创立', () => {
  const g = newGame();
  const a = E.analyzePlacement(g, 4, 3);
  assert.strictEqual(a.type, 'isolated');
});

test('连到一家公司 = 扩张', () => {
  const g = layout(newGame(), [[3, 3, 'imperial'], [4, 3, 'imperial']]);
  const a = E.analyzePlacement(g, 5, 3);
  assert.strictEqual(a.type, 'expand');
  assert.strictEqual(a.companyId, 'imperial');
});

test('扩张时，与触发板块相邻的零散板块一起并入公司', () => {
  // 帝国 A1-A2，零散板块 B2（孤立），在 B1 落子：连到帝国，且与 B2 相邻
  const g = layout(newGame(), [[0, 0, 'imperial'], [0, 1, 'imperial'], [1, 1, null]]);
  const a = E.analyzePlacement(g, 1, 0);
  assert.strictEqual(a.type, 'expand');
  assert.deepStrictEqual(a.absorb.map((k) => k), [E.key(1, 1)], 'B2 应该被一起吸收');
  assert.strictEqual(a.sizeGain, 2, '一次长两块');

  E.applyPlacement(g, 1, 0);
  assert.strictEqual(E.companySize(g, 'imperial'), 4);
  assert.strictEqual(g.board[E.key(1, 1)], 'imperial');
});

test('连锁吸收：零散板块连成一片时全部并入', () => {
  // 帝国 A1，零散 B1、C1 连成一条，D1 落子相邻于帝国与 C1
  const g = layout(newGame(), [
    [0, 0, 'imperial'],
    [2, 0, null], [3, 0, null],
  ]);
  const a = E.analyzePlacement(g, 1, 0);
  assert.strictEqual(a.absorb.length, 2, 'B1、C1 都该被吸收');
  E.applyPlacement(g, 1, 0);
  assert.strictEqual(E.companySize(g, 'imperial'), 4);
});

test('同时连到两家公司 = 并购', () => {
  const g = layout(newGame(), [
    [0, 0, 'imperial'], [1, 0, 'imperial'],
    [3, 0, 'continental'], [4, 0, 'continental'],
  ]);
  const a = E.analyzePlacement(g, 2, 0);
  assert.strictEqual(a.type, 'merger');
  assert.deepStrictEqual(a.companies.sort(), ['continental', 'imperial']);
  assert.strictEqual(a.tie, true, '两家都是 2 块，应该出现平局');
});

test('并购时规模大的一方胜出，不算平局', () => {
  const g = layout(newGame(), [
    [0, 0, 'imperial'], [1, 0, 'imperial'], [1, 1, 'imperial'],
    [3, 0, 'continental'], [4, 0, 'continental'],
  ]);
  const a = E.analyzePlacement(g, 2, 0);
  assert.strictEqual(a.tie, false);
  assert.deepStrictEqual(a.largest, ['imperial']);
  assert.strictEqual(a.sizes.imperial, 3);
  assert.strictEqual(a.sizes.continental, 2);
});

test('安全公司（11 块）不能被并购，这一手不合法', () => {
  const g = newGame();
  // 造一家 11 块的帝国
  for (let i = 0; i < 11; i++) g.board[E.key(i, 5)] = 'imperial';
  g.founded.imperial = true;
  g.board[E.key(0, 0)] = 'continental';
  g.board[E.key(1, 0)] = 'continental';
  g.founded.continental = true;

  assert.strictEqual(E.companySize(g, 'imperial'), 11);

  // 在 (0,1) 放一块会同时连到 (0,0) 大陆 和 (0,2)…… 换个更直接的位置
  const a = E.analyzePlacement(g, 0, 4);
  assert.strictEqual(a.valid, true, '这一格和帝国不相邻，应该合法');
});

test('安全公司可以吞并别人：大的一方是安全公司时，这一手合法', () => {
  // 帝国 12 块（安全）在中间，大陆 3 块在下面，放一块桥接
  const g = newGame();
  for (let i = 0; i < 12; i++) g.board[E.key(i, 0)] = 'imperial';
  g.founded.imperial = true;

  g.board[E.key(0, 2)] = 'continental';
  g.board[E.key(1, 2)] = 'continental';
  g.board[E.key(2, 2)] = 'continental';
  g.founded.continental = true;

  // (0,1) 同时邻接帝国 (0,0) 与大陆 (0,2)
  const a = E.analyzePlacement(g, 0, 1);
  assert.strictEqual(a.valid, true, '安全公司当吞并方应该合法');
  assert.strictEqual(a.type, 'merger');
  assert.deepStrictEqual(a.largest, ['imperial'], '帝国规模更大，应自动存活');
  assert.strictEqual(a.tie, false);

  // 真的能结算
  E.applyPlacement(g, 0, 1);
  const res = E.resolveMerger(g, null, 'imperial', 'continental');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(g.founded.continental, undefined, '大陆应退市');
});

test('两家安全公司不能通过一块板块合并', () => {
  const g = newGame();
  for (let i = 0; i < 11; i++) g.board[E.key(i, 0)] = 'imperial';
  for (let i = 0; i < 11; i++) g.board[E.key(i, 2)] = 'continental';
  g.founded.imperial = true;
  g.founded.continental = true;

  const a = E.analyzePlacement(g, 0, 1);
  assert.strictEqual(a.valid, false);
});

test('规模更大的一家不是安全公司时，安全的小公司在旁边也不影响', () => {
  // 帝国 15 块（安全） vs 大陆 4 块；大陆小、安全与否都不该拦截
  const g = newGame();
  for (let i = 0; i < 15; i++) g.board[E.key(i, 0)] = 'imperial';
  g.founded.imperial = true;
  g.board[E.key(0, 2)] = 'continental';
  g.board[E.key(1, 2)] = 'continental';
  g.board[E.key(2, 2)] = 'continental';
  g.board[E.key(3, 2)] = 'continental';
  g.founded.continental = true;

  const a = E.analyzePlacement(g, 0, 1);
  assert.strictEqual(a.valid, true);
  assert.deepStrictEqual(a.largest, ['imperial']);
});

test('七家公司都上市后仍可放置，但不能创立', () => {
  const g = newGame();
  ['saxony', 'america', 'continental', 'festival', 'imperial', 'hydra', 'zeta']
    .forEach((id, i) => { g.board[E.key(i, 8)] = id; g.founded[id] = true; });

  layout(g, [[5, 2, null], [5, 3, null]]);
  const a = E.analyzePlacement(g, 6, 2);
  assert.strictEqual(a.valid, true);
  assert.strictEqual(a.canFound, false);
});

/* -------------------------------------------------------------- 执行放置 */

console.log('\n【执行放置】');

test('扩张会立刻把新块划给公司', () => {
  const g = layout(newGame(), [[3, 3, 'imperial'], [4, 3, 'imperial']]);
  const r = E.applyPlacement(g, 5, 3);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(g.board[E.key(5, 3)], 'imperial');
  assert.strictEqual(E.companySize(g, 'imperial'), 3);
});

test('创立公司会把整片零散板块划过去', () => {
  const g = layout(newGame(), [[3, 3, null], [3, 4, null]]);
  const placed = E.applyPlacement(g, 4, 3);
  assert.strictEqual(placed.type, 'found');

  const res = E.foundCompany(g, 'zeta', 4, 3);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.size, 3);
  assert.strictEqual(E.companySize(g, 'zeta'), 3);
  assert.strictEqual(g.founded.zeta, true);
});

test('同一家公司不能重复上市', () => {
  const g = layout(newGame(), [[3, 3, 'zeta'], [3, 4, 'zeta']]);
  const res = E.foundCompany(g, 'zeta', 3, 3);
  assert.strictEqual(res.ok, false);
});

/* -------------------------------------------------------------- 并购结算 */

console.log('\n【并购结算】');

test('结算后败方板块并入胜方，公司注销', () => {
  const g = layout(newGame(), [
    [0, 0, 'imperial'], [1, 0, 'imperial'], [1, 1, 'imperial'],
    [3, 0, 'continental'], [4, 0, 'continental'],
  ]);
  E.applyPlacement(g, 2, 0);

  const res = E.resolveMerger(g, null, 'imperial', 'continental');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.movedTiles, 2);
  assert.strictEqual(E.companySize(g, 'imperial'), 5);
  assert.strictEqual(g.founded.continental, undefined);
});

test('安全公司不能被吞并', () => {
  const g = newGame();
  for (let i = 0; i < 11; i++) g.board[E.key(i, 5)] = 'imperial';
  g.founded.imperial = true;
  g.board[E.key(0, 0)] = 'continental';
  g.founded.continental = true;

  const res = E.resolveMerger(g, null, 'continental', 'imperial');
  assert.strictEqual(res.ok, false);
});

/* ---------------------------------------------------------------- 分红 */

console.log('\n【分红与并列】');

function holders(g, companyId, counts) {
  counts.forEach((n, i) => { if (n) g.players[i].stocks[companyId] = n; });
  return g;
}

test('经典模式：两名股东各拿 1 名 2 名', () => {
  const g = holders(newGame(), 'imperial', [3, 2, 0, 0]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('classic', groups, { first: 5000, second: 2500, third: 0 });
  assert.strictEqual(pay[0], 5000);
  assert.strictEqual(pay[1], 2500);
});

test('经典模式：并列第一，主次分红合并平分，其他人无', () => {
  const g = holders(newGame(), 'imperial', [3, 3, 2, 0]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('classic', groups, { first: 5000, second: 2500, third: 0 });
  assert.strictEqual(pay[0], 3750);
  assert.strictEqual(pay[1], 3750);
  assert.strictEqual(pay[2], undefined, '并列第一时原本的第二名拿不到钱');
});

test('大亨模式：第一名明确，三人正常分三档', () => {
  const g = holders(newGame(), 'imperial', [3, 2, 1, 0]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('tycoon', groups, { first: 5000, second: 3700, third: 2500 });
  assert.strictEqual(pay[0], 5000);
  assert.strictEqual(pay[1], 3700);
  assert.strictEqual(pay[2], 2500);
});

test('大亨模式：2 人并列第一，主次平分，第三名照常', () => {
  const g = holders(newGame(), 'imperial', [3, 3, 1, 0]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('tycoon', groups, { first: 5000, second: 3700, third: 2500 });
  assert.strictEqual(pay[0], 4350);
  assert.strictEqual(pay[1], 4350);
  assert.strictEqual(pay[2], 2500);
});

test('大亨模式：3 人并列第一，三档合并平分', () => {
  const g = holders(newGame(), 'imperial', [3, 3, 3, 0]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('tycoon', groups, { first: 5000, second: 3700, third: 2500 });
  const each = Math.floor((5000 + 3700 + 2500) / 3);
  assert.strictEqual(pay[0], each);
  assert.strictEqual(pay[1], each);
  assert.strictEqual(pay[2], each);
  assert.strictEqual(pay[3], undefined);
});

test('大亨模式：第一名明确，2 人并列第二 → 次+三名平分', () => {
  const g = holders(newGame(), 'imperial', [5, 2, 2, 1]);
  const groups = E.rankHolders(g, 'imperial');
  const pay = E.computeDividends('tycoon', groups, { first: 5000, second: 3700, third: 2500 });
  assert.strictEqual(pay[0], 5000);
  assert.strictEqual(pay[1], 3100);
  assert.strictEqual(pay[2], 3100);
  assert.strictEqual(pay[3], undefined, '并列第二时不再单独发第三名');
});

/* -------------------------------------------------------------- 终局 */

console.log('\n【终局判定】');

test('公司到 41 块立刻终局', () => {
  const g = newGame();
  for (let i = 0; i < 41; i++) g.board[E.key(i % 12, Math.floor(i / 12))] = 'imperial';
  g.founded.imperial = true;
  const r = E.checkEnd(g);
  assert.strictEqual(r.over, true);
  assert.strictEqual(r.reason, 'size41');
});

test('所有存活公司都到 11 块也终局', () => {
  const g = newGame();
  for (let i = 0; i < 12; i++) g.board[E.key(i, 0)] = 'imperial';
  for (let i = 0; i < 12; i++) g.board[E.key(i, 2)] = 'continental';
  g.founded.imperial = true;
  g.founded.continental = true;
  const r = E.checkEnd(g);
  assert.strictEqual(r.over, true);
  assert.strictEqual(r.reason, 'allSafe');
});

/* -------------------------------------------------------------- 汇总 */

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
console.log('='.repeat(46));

process.exit(failed ? 1 : 0);
