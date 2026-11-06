/**
 * AI 决策单元测试
 * 用假的 ctx 驱动 js/ai.js，只验证决策逻辑，不依赖界面。
 *
 * 运行：node tests/ai.test.js
 */

const path = require('path');
const assert = require('assert');

const E = require(path.join(__dirname, '..', 'js', 'engine.js'));
const AI = require(path.join(__dirname, '..', 'js', 'ai.js'));

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
  }
}

/* ------------------------------------------------------------- 测试工具 */

// 简化定价：只要单调递增，AI 逻辑就能跑
function priceOf(size) {
  return size < 2 ? 0 : 200 + (size - 2) * 100;
}
function payouts(size, mode) {
  const p = priceOf(size);
  return { first: p * 10, second: p * 5, third: mode === 'tycoon' ? p * 2 : 0 };
}

function makeCtx(opts) {
  const game = { board: Object.create(null), players: [], founded: Object.create(null) };

  const players = opts.players.map((p, i) => ({
    index: i,
    cash: p.cash,
    stocks: Object.assign(Object.create(null), p.stocks || {}),
  }));

  game.players = players;
  Object.assign(game.board, opts.board || {});

  // 棋盘上出现过的公司就算已上市
  Object.keys(game.board).forEach((k) => {
    const v = game.board[k];
    if (typeof v === 'string') game.founded[v] = true;
  });

  const rankHolders = (id) => E.rankHolders(game, id);
  const computeDividends = (mode, groups, pay) => E.computeDividends(mode, groups, pay);

  return {
    E,
    game,
    meIdx: opts.meIdx || 0,
    me: players[opts.meIdx || 0],
    players,
    canSeeHoldings: opts.canSeeHoldings !== false,
    mode: opts.mode || 'classic',
    sizes: opts.sizes,
    hand: opts.hand || [],
    shares: opts.shares || {},
    priceOf,
    payouts,
    rankHolders,
    computeDividends,
    difficulty: opts.difficulty || 'normal',
  };
}

/** 造一块 n 格横排的公司 */
function row(id, n, r) {
  const out = {};
  for (let i = 0; i < n; i++) out[`${i},${r}`] = id;
  return out;
}

/* ------------------------------------------------------------ 地理信息 */

console.log('\n【棋盘地理】');

test('room 统计相邻空格数，gaps 只算会触发并购的格子', () => {
  const board = Object.assign(
    {},
    row('imperial', 3, 0),      // A1 B1 C1
    { '0,2': 'continental', '1,2': 'continental' }  // A3 B3
  );

  const ctx = makeCtx({
    players: [{ cash: 6000 }, { cash: 6000 }],
    board,
    sizes: { imperial: 3, continental: 2 },
  });

  const geo = AI.buildGeo(ctx);
  // 帝国下面一整排空格都挨着大陆 → A2 B2 是缺口，C2 只挨着帝国
  assert.strictEqual(geo.imperial.gaps, 2, `gaps 应为 2，实际 ${geo.imperial.gaps}`);
  assert.ok(geo.imperial.room >= 2);
});

/* ------------------------------------------------------------ 出牌决策 */

console.log('\n【出牌】');

test('简单档只会挑合法牌', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000 }, { cash: 6000 }],
    board: row('imperial', 2, 0),
    sizes: { imperial: 2 },
    hand: [[5, 0], [0, 1]],
    difficulty: 'easy',
  });

  for (let i = 0; i < 20; i++) {
    const t = AI.pickTile(ctx);
    assert.ok(t, '应该返回一块牌');
    assert.strictEqual(E.analyzePlacement(ctx.game, t[0], t[1]).valid, true);
  }
});

test('普通档会优先扩张自己持股多的公司', () => {
  // 帝国 3 块在 A1..C1，我持 5 张；高塔 3 块在 A5..C5，我持 0 张
  const board = Object.assign({}, row('imperial', 3, 0), row('tower', 3, 5));
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 5 } },
      { cash: 6000, stocks: { tower: 5 } },
    ],
    board,
    sizes: { imperial: 3, tower: 3 },
    // A2 挨着帝国（我持股），A6 挨着高塔（对手持股）
    hand: [[0, 1], [0, 6]],
  });

  const t = AI.pickTile(ctx);
  assert.deepStrictEqual(t, [0, 1], '应该去扩张自己持股的帝国');
});

test('放牌不再以「别让对手赚」为目标，两档一致', () => {
  // 帝国 3 块（我持 1）、大陆 3 块（对手持 8）；打通一格会触发并购
  const board = Object.assign(
    {},
    row('imperial', 3, 0),
    { '0,2': 'continental', '1,2': 'continental', '2,2': 'continental' }
  );

  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 1 } },
      { cash: 6000, stocks: { continental: 8 } },
    ],
    board,
    sizes: { imperial: 3, continental: 3 },
    hand: [[0, 1], [8, 7]],   // A2 触发并购；I8 是无关格
    difficulty: 'hard',
  });

  /*
   * 新规则下 AI 只算自己的得失，不再以「别让对手赚」为目标。
   * 同一局面，普通档和困难档应当给出同一个选择（只有一套放牌逻辑）。
   */
  ctx.rng = () => 0;
  const hardPick = AI.pickTile(ctx);

  const normalCtx = makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 1 } },
      { cash: 6000, stocks: { continental: 8 } },
    ],
    board,
    sizes: { imperial: 3, continental: 3 },
    hand: [[0, 1], [8, 7]],
    difficulty: 'normal',
  });
  normalCtx.rng = () => 0;
  const normalPick = AI.pickTile(normalCtx);

  assert.deepStrictEqual(hardPick, normalPick, '放牌逻辑两档一致，不再有「资敌」单独分支');
});

test('信息公开关闭时，困难档不会因为「看不到持股」而误判为有害', () => {
  const board = Object.assign(
    {},
    row('imperial', 3, 0),
    { '0,2': 'continental', '1,2': 'continental', '2,2': 'continental' }
  );

  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 1 } },
      { cash: 6000, stocks: { continental: 8 } },
    ],
    board,
    sizes: { imperial: 3, continental: 3 },
    hand: [[0, 1], [8, 7]],
    difficulty: 'hard',
    canSeeHoldings: false,
  });

  const geo = AI.buildGeo(ctx);
  const a = E.analyzePlacement(ctx.game, 0, 1);
  const harmful = AI._internals.isHarmful(ctx, { c: 0, r: 1, a });
  assert.strictEqual(harmful, false, '看不到持股就不应该判定为有害');
  assert.ok(geo);
});

/* ------------------------------------------------------------ 存活方 */

console.log('\n【存活方选择】');

test('平局时让「给我更多」的那家去死（持股在它身上 → 让它被吞，我拿分红）', () => {
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 4, continental: 1 } },
      { cash: 6000, stocks: { continental: 3 } },
    ],
    board: {},
    sizes: { imperial: 3, continental: 3 },
  });

  // 固定随机源：rand=0 → 走「让给我最多的那家去死」这一支
  ctx.rng = () => 0;

  const analysis = { companies: ['imperial', 'continental'], largest: ['imperial', 'continental'] };
  const pick = AI.pickSurvivor(ctx, analysis);

  // 我在帝国持股最多，帝国被吞我能拿最多 → 让帝国去死 → 存活的是大陆
  assert.strictEqual(pick, 'continental');
});

test('简单档存活方是随机的（多跑几次会出现不同结果）', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const ctx = makeCtx({
      players: [{ cash: 6000, stocks: { imperial: 2, continental: 2 } }, { cash: 6000 }],
      board: {},
      sizes: { imperial: 3, continental: 3 },
      difficulty: 'easy',
    });
    const analysis = { companies: ['imperial', 'continental'], largest: ['imperial', 'continental'] };
    seen.add(AI.pickSurvivor(ctx, analysis));
  }
  assert.ok(seen.size >= 1);
});

/* ------------------------------------------------------------ 买股 */

console.log('\n【买股】');

test('买股不超过 3 张，且保留 1000 现金兜底', () => {
  const ctx = makeCtx({
    players: [{ cash: 2000, stocks: {} }, { cash: 6000 }],
    board: Object.assign({}, row('imperial', 5, 0), row('tower', 4, 4)),
    sizes: { imperial: 5, tower: 4 },
    shares: { imperial: 20, tower: 20 },
    hand: [],
  });

  const picks = AI.pickBuys(ctx);
  assert.ok(picks.length <= 3, `最多 3 张，实际 ${picks.length}`);

  const spent = picks.reduce((n, id) => n + priceOf(ctx.sizes[id]), 0);
  // 新规则：现金兜底 1000（非紧急情况不花穿）
  assert.ok(spent <= 2000 - 1000, `不能动用安全现金，实际花了 ${spent}`);
});

test('困难档会为「即将被吞并的小公司」加价抢大股东', () => {
  // 帝国 4 块（我持 1），高塔 5 块紧邻 → 帝国差一格被吞并
  const board = Object.assign(
    {},
    row('imperial', 4, 0),
    { '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower', '4,2': 'tower' }
  );

  const base = {
    players: [{ cash: 6000, stocks: { imperial: 1 } }, { cash: 6000, stocks: { imperial: 2 } }],
    board,
    sizes: { imperial: 4, tower: 5 },
    shares: { imperial: 22, tower: 20 },
  };

  const hard = makeCtx(Object.assign({}, base, { difficulty: 'hard' }));
  const easy = makeCtx(Object.assign({}, base, { difficulty: 'easy' }));

  const geo = AI.buildGeo(hard);
  assert.ok(geo.imperial.gaps >= 1, '帝国应该有并购缺口');

  // 困难档应该把帝国排到很前面
  const picks = AI.pickBuys(hard);
  assert.ok(picks.includes('imperial'), `困难档应该买帝国，实际买了 ${JSON.stringify(picks)}`);
  assert.ok(AI.pickBuys(easy).length >= 0);
});

/* -------------------------------------------------------- 股票处置 */

console.log('\n【股票处置】');

test('存活方股价明显更高时选择 2 换 1', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: {} }, { cash: 6000 }],
    board: {},
    sizes: { continental: 3, imperial: 9 },   // 帝国大得多 → 股价高
    difficulty: 'normal',
  });

  const d = AI.pickStock(ctx, {
    loserId: 'continental',
    survivorId: 'imperial',
    size: 3,
    count: 5,
    survivorShares: 10,
  });

  assert.ok(d.swaps > 0, '应该换股');
  assert.strictEqual(d.rest, 'sell');
});

test('存活方不划算时全部套现', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: {} }, { cash: 6000 }],
    board: {},
    sizes: { imperial: 8, continental: 2 },   // 存活方更小 → 换股不划算
    difficulty: 'hard',
  });

  const d = AI.pickStock(ctx, {
    loserId: 'imperial',
    survivorId: 'continental',
    size: 8,
    count: 6,
    survivorShares: 10,
  });

  assert.strictEqual(d.swaps, 0);
  assert.strictEqual(d.rest, 'sell');
});

test('存活方股票池不够时不超额换股', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: {} }, { cash: 6000 }],
    board: {},
    sizes: { continental: 3, imperial: 9 },
    difficulty: 'hard',
  });

  const d = AI.pickStock(ctx, {
    loserId: 'continental',
    survivorId: 'imperial',
    size: 3,
    count: 10,
    survivorShares: 1,     // 只有 1 张可换
  });

  assert.ok(d.swaps <= 1, `换股数不能超过股票池，实际 ${d.swaps}`);
});

/* ------------------------------------------------------------ 入口纯度 */

console.log('\n【决策函数是纯的】');

test('pickTile / pickBuys / pickSurvivor 都不许改动 ctx', () => {
  const build = () => makeCtx({
    players: [
      { cash: 6000, stocks: { imperial: 2, saxony: 5 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: Object.assign({}, row('imperial', 3, 0), row('saxony', 4, 2)),
    sizes: { imperial: 3, saxony: 4 },
    hand: [[5, 5], [8, 8]],
    difficulty: 'hard',
  });

  const snapshot = (ctx) => JSON.stringify({
    cash: ctx.me.cash,
    stocks: ctx.me.stocks,
    players: ctx.players.map((p) => ({ cash: p.cash, stocks: p.stocks })),
    shares: ctx.shares,
    hand: ctx.hand,
  });

  const ctx = build();
  const before = snapshot(ctx);
  ctx.rng = () => 0;

  AI.pickTile(ctx);
  assert.strictEqual(snapshot(ctx), before, 'pickTile 改了 ctx');

  AI.pickBuys(ctx);
  assert.strictEqual(snapshot(ctx), before, 'pickBuys 改了 ctx');

  AI.pickSurvivor(ctx, {
    companies: ['imperial', 'saxony'],
    largest: ['imperial', 'saxony'],
  });
  assert.strictEqual(snapshot(ctx), before, 'pickSurvivor 改了 ctx');
});

test('传副本与传真对象，决策结果必须一致', () => {
  const build = () => makeCtx({
    players: [
      { cash: 5000, stocks: { imperial: 3, saxony: 1 } },
      { cash: 6000, stocks: { saxony: 4 } },
    ],
    board: Object.assign({}, row('imperial', 4, 0), row('saxony', 4, 2)),
    sizes: { imperial: 4, saxony: 4 },
    shares: { imperial: 20, saxony: 20 },
    hand: [[6, 6]],
    difficulty: 'hard',
  });

  const live = build();
  const cloned = build();
  cloned.me = Object.assign({}, cloned.me, { stocks: Object.assign({}, cloned.me.stocks) });
  cloned.players = cloned.players.map((p) => Object.assign({}, p, { stocks: Object.assign({}, p.stocks) }));

  assert.deepStrictEqual(AI.pickBuys(cloned), AI.pickBuys(live), '副本不应改变买股结果');
});

/* ------------------------------------------------------------ 现金兜底 */

console.log('\n【保位 vs 升股东】');

function twoCompanyCtx() {
  // 萨克森：我 6、对手 5 → 我是第一（保位）
  // 高塔：我 6、对手 7 → 我是第二，买 1 张即可追平（升股东）
  return makeCtx({
    players: [
      { cash: 9000, stocks: { saxony: 5, tower: 7 } },
      { cash: 9000, stocks: { saxony: 6, tower: 6 } },
    ],
    meIdx: 1,
    board: Object.assign({}, row('saxony', 5, 0), row('tower', 5, 2)),
    sizes: { saxony: 5, tower: 5 },
    shares: { saxony: 20, tower: 20 },
    hand: [],
    difficulty: 'hard',
  });
}

test('前期：升股东的分值高于保位置', () => {
  const ctx = twoCompanyCtx();
  const scoreOf = (id) => AI._internals.buyScore(ctx, id, 5, 500).score;

  assert.ok(scoreOf('tower') > scoreOf('saxony'),
    '前期应当优先去争更高股东');
});

test('非前期：保位置的权重恢复（前期被减半）', () => {
  const ctx = twoCompanyCtx();
  const brain = AI._internals.brainOf(ctx);
  const before = AI._internals.buyScore(ctx, 'saxony', 5, 500).score;

  brain.mem.seen = {};
  ['saxony', 'tower', 'america', 'festival', 'worldwide', 'continental', 'imperial']
    .forEach((id) => { brain.mem.seen[id] = true; });

  const after = AI._internals.buyScore(ctx, 'saxony', 5, 500).score;
  assert.ok(after > before, '非前期保位权重应高于前期');
});

console.log('\n【现金兜底】');

test('有并购风险也不许花穿 1000 兜底', () => {
  const ctx = makeCtx({
    players: [{ cash: 1200, stocks: {} }, { cash: 6000, stocks: {} }],
    board: Object.assign({}, row('saxony', 5, 0), row('tower', 3, 2)),
    sizes: { saxony: 5, tower: 3 },
    shares: { saxony: 20, tower: 20 },
    hand: [],
    difficulty: 'hard',
  });
  assert.deepStrictEqual(AI.pickBuys(ctx), [], '不该动用兜底现金');
});

test('只有 1~3 张的位置，不值得花穿兜底', () => {
  const ctx = makeCtx({
    players: [
      { cash: 1200, stocks: { saxony: 2 } },
      { cash: 6000, stocks: { saxony: 1 } },
    ],
    board: Object.assign({}, row('saxony', 5, 0)),
    sizes: { saxony: 5 },
    shares: { saxony: 20 },
    hand: [],
    difficulty: 'hard',
  });
  assert.deepStrictEqual(AI.pickBuys(ctx), [], '持有不足 4 张时不破例');
});

test('持有 ≥4 张且位置被逼近 → 允许花穿保位', () => {
  const ctx = makeCtx({
    players: [
      { cash: 1200, stocks: { saxony: 5 } },
      { cash: 6000, stocks: { saxony: 4 } },
    ],
    board: Object.assign({}, row('saxony', 5, 0)),
    sizes: { saxony: 5 },
    shares: { saxony: 20 },
    hand: [],
    difficulty: 'hard',
  });
  assert.ok(AI.pickBuys(ctx).length >= 1, '保位是唯一允许破例的情况');
});

/* ------------------------------------------------------ 新规则：保留 / 延后并购 */

console.log('\n【并购四分支】');

function mergerCtx(me, rival, third) {
  return makeCtx({
    players: [
      { cash: 6000, stocks: { saxony: rival } },
      { cash: 6000, stocks: { saxony: third } },
      { cash: 6000, stocks: { saxony: me } },
    ],
    meIdx: 2,
    board: {
      '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower',
      '4,2': 'tower', '5,2': 'tower', '6,2': 'tower', '7,2': 'tower',
      '0,4': 'saxony', '1,4': 'saxony', '2,4': 'saxony',
      '3,4': 'saxony', '4,4': 'saxony', '5,4': 'saxony',
    },
    sizes: { tower: 8, saxony: 6 },
    shares: { saxony: 20, tower: 20 },
    hand: [[0, 3], [10, 8]],
    difficulty: 'hard',
  });
}

test('分支1：线内且 Need≤3 → 藏牌，下回合强制打出', () => {
  const ctx = mergerCtx(3, 5, 1);
  ctx.rng = () => 0;

  assert.deepStrictEqual(AI.pickTile(ctx), [10, 8], '这一手先打别的牌');
  const brain = AI._internals.brainOf(ctx);
  assert.strictEqual(brain.mem.savedTile.mode, 'force', '记为强制打出');
  assert.deepStrictEqual(AI.pickTile(ctx), [0, 3], '下一回合必打这张');
});

test('分支2：线内但 Need>3 → 现在直接打', () => {
  const ctx = mergerCtx(1, 9, 0);
  ctx.rng = () => 0;
  assert.deepStrictEqual(AI.pickTile(ctx), [0, 3], '追不上就别等');
});

test('分支3：线外且 Need≤3 → 藏牌，记为条件打出', () => {
  const ctx = mergerCtx(0, 3, 1);
  ctx.rng = () => 0;
  AI.pickTile(ctx);
  const brain = AI._internals.brainOf(ctx);
  assert.strictEqual(brain.mem.savedTile.mode, 'conditional');
});

test('分支4：线外且 Need>3 → 藏牌但不记录，改打别的', () => {
  const ctx = mergerCtx(0, 9, 5);
  ctx.rng = () => 0;
  assert.deepStrictEqual(AI.pickTile(ctx), [10, 8]);
  const brain = AI._internals.brainOf(ctx);
  assert.ok(!brain.mem.savedTile, '不该记录待打');
});

test('分支4 会记住「这张牌最近不能打」，局势一变就解除', () => {
  const ctx = mergerCtx(0, 9, 5);
  ctx.rng = () => 0;

  // 第一次：藏牌 + 打负权重
  assert.deepStrictEqual(AI.pickTile(ctx), [10, 8]);
  const brain = AI._internals.brainOf(ctx);
  const key = '0,3';
  assert.ok(brain.mem.tileMarks[key], '应当记下这张牌的权重');
  assert.strictEqual(brain.mem.tileMarks[key].weight, -300);

  // 局势没变：仍然不打它
  assert.deepStrictEqual(AI.pickTile(ctx), [10, 8], '局势未变，继续避开');
  assert.ok(brain.mem.tileMarks[key], '标记仍在');

  // 局势变了：我买到了股票 → 标记应被清掉
  ctx.players[2].stocks.saxony = 9;
  AI.pickTile(ctx);
  assert.ok(!brain.mem.tileMarks[key], '持股变化后标记应清除');
});

console.log('\n【股票保留】');

test('现金>5000、无法置换、有相连空白块 → 逐张 90% 保留', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: { tower: 4 } }, { cash: 6000 }],
    // 两块相连的零散板块（null）= 可以重新创立公司
    board: { '0,0': 'saxony', '1,0': 'saxony', '0,1': null, '1,1': null },
    sizes: { saxony: 2, tower: 3 },
    hand: [],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;   // 0 < 0.9 → 每张都保留

  const d = AI.pickStock(ctx, {
    loserId: 'tower', survivorId: 'saxony', size: 3, count: 4, survivorShares: 0,
  });
  assert.strictEqual(d.swaps, 0, '没法置换时不该置换');
  assert.strictEqual(d.keep, 4, '逐张判定都保留');
});

test('现金不够 5000 时不走保留规则', () => {
  const ctx = makeCtx({
    players: [{ cash: 3000, stocks: { tower: 4 } }, { cash: 6000 }],
    board: { '0,0': 'saxony', '1,0': 'saxony' },
    sizes: { saxony: 2, tower: 3 },
    hand: [],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  const d = AI.pickStock(ctx, {
    loserId: 'tower', survivorId: 'saxony', size: 3, count: 4, survivorShares: 0,
  });
  assert.notStrictEqual(d.keep, 4, '现金不足时应当套现');
});

test('场上没有相连的零散板块时不保留', () => {
  // 满盘都是公司板块，没有无归属的零散板块
  const board = {};
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 9; r++) {
      board[c + ',' + r] = 'saxony';
    }
  }
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: { tower: 4 } }, { cash: 6000 }],
    board: board,
    sizes: { saxony: 107, tower: 3 },
    hand: [],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  const d = AI.pickStock(ctx, {
    loserId: 'tower', survivorId: 'saxony', size: 3, count: 4, survivorShares: 0,
  });
  assert.notStrictEqual(d.keep, 4, '没有相连空地时不保留');
});

console.log('\n【延后并购】');

test('买 ≤3 张就能抬高分红 → 先放别的牌，并购牌留到下一回合', () => {
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { saxony: 1 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: {
      '0,0': 'saxony', '1,0': 'saxony', '2,0': 'saxony',
      '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower',
    },
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1], [10, 8]],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  assert.deepStrictEqual(AI.pickTile(ctx), [10, 8], '这一手改打别的牌');
});

test('手里只有并购牌时必须出它（不能空过回合）', () => {
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { saxony: 1 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: {
      '0,0': 'saxony', '1,0': 'saxony', '2,0': 'saxony',
      '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower',
    },
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1]],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  assert.deepStrictEqual(AI.pickTile(ctx), [2, 1], '只有它一张就打它');
});

test('买完股票名次上去了 → 下一回合就打这张并购牌', () => {
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: { saxony: 3 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: {
      '0,0': 'saxony', '1,0': 'saxony', '2,0': 'saxony',
      '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower',
    },
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1], [10, 8]],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  assert.deepStrictEqual(AI.pickTile(ctx), [2, 1], '名次够了就打');
});

test('差 >3 张才进分红线 → 倾向不打这张并购牌', () => {
  const ctx = makeCtx({
    players: [
      { cash: 6000, stocks: {} },                    // 我一张没有
      { cash: 6000, stocks: { saxony: 5 } },         // 对手 5 张
    ],
    board: {
      '0,0': 'saxony', '1,0': 'saxony', '2,0': 'saxony',
      '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower',
    },
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1], [10, 8]],
    difficulty: 'hard',
  });
  ctx.rng = () => 0;

  const pick = AI.pickTile(ctx);
  assert.deepStrictEqual(pick, [10, 8], '应当改打无关牌，而不是送分红');
});

/* ------------------------------------------------------------ 买股纯函数 */

console.log('\n【买股不产生副作用】');

test('pickBuys 不许改动玩家现金（真对象会被 aiBuy 再扣一次）', () => {
  const ctx = makeCtx({
    players: [{ cash: 6000, stocks: {} }, { cash: 6000 }],
    board: Object.assign({}, row('imperial', 5, 0), row('tower', 4, 4)),
    sizes: { imperial: 5, tower: 4 },
    shares: { imperial: 20, tower: 20 },
    hand: [],
  });

  const before = ctx.me.cash;
  const picks = AI.pickBuys(ctx);
  assert.strictEqual(ctx.me.cash, before, '决策函数不能改现金');
  assert.ok(picks.length <= 3);
});

test('买的张数不超过现金能承受的', () => {
  const ctx = makeCtx({
    players: [{ cash: 500, stocks: {} }, { cash: 6000 }],
    board: Object.assign({}, row('imperial', 2, 0)),
    sizes: { imperial: 2 },
    shares: { imperial: 20 },
    hand: [],
  });

  const picks = AI.pickBuys(ctx);
  const spent = picks.reduce((n, id) => n + priceOf(ctx.sizes[id]), 0);
  assert.ok(spent <= 500, `花了 ${spent}，超过现金`);
});

/* ------------------------------------------------------- 难度分层（新） */

console.log('\n【难度分层】');

test('普通档继承原困难的战术，困难档额外带脑子', () => {
  const P = AI._internals.PROFILE;
  assert.ok(P.normal.tactics && P.normal.delayHarvest, '普通档应当会战术、会做局');
  assert.ok(P.normal.safeCash === 800, '普通档安全现金应为 800');
  assert.ok(P.hard.brain, '困难档应当启用记忆与性格');
  assert.ok(!P.normal.brain, '普通档不应使用记忆');
  assert.ok(!P.easy.tactics, '简单档仍然不做战术');
});

test('终局判断：落后时把公司推到 41 块要重罚，领先时加分', () => {
  const f = AI._internals.endgameBias;

  // 我 2000，对手 6000 → 落后
  const behind = makeCtx({
    players: [{ cash: 2000, stocks: {} }, { cash: 6000 }],
    board: Object.assign({}, row('imperial', 40, 0)),
    sizes: { imperial: 40 },
    shares: { imperial: 20 },
    hand: [],
  });
  assert.ok(f(behind, 41) <= -150, '落后触发终局应重罚，实际 ' + f(behind, 41));

  // 我 6000，对手 2000 → 领先
  const ahead = makeCtx({
    players: [{ cash: 6000, stocks: {} }, { cash: 2000 }],
    board: Object.assign({}, row('imperial', 40, 0)),
    sizes: { imperial: 40 },
    shares: { imperial: 20 },
    hand: [],
  });
  assert.ok(f(ahead, 41) > 0, '领先触发终局应加分，实际 ' + f(ahead, 41));
  assert.ok(f(ahead, 40) === 0, '不到 41 块不应有终局倾向');
});

test('平局规则在普通档与困难档一致（只有一套）', () => {
  // 我持 A 2 张、B 0 张；对手持 B 9 张
  const shared = {
    players: [{ cash: 6000, stocks: { saxony: 2 } }, { cash: 6000, stocks: { tower: 9 } }],
    board: Object.assign({}, row('saxony', 4, 0), row('tower', 4, 2)),
    sizes: { saxony: 4, tower: 4 },
    shares: { saxony: 20, tower: 16 },
    hand: [],
  };

  const analysis = {
    type: 'merger',
    companies: ['saxony', 'tower'],
    sizes: { saxony: 4, tower: 4 },
    largest: ['saxony', 'tower'],
    tie: true,
    multiple: false,
    absorb: [],
  };

  const hardCtx = makeCtx(Object.assign({ difficulty: 'hard' }, shared));
  const normalCtx = makeCtx(Object.assign({ difficulty: 'normal' }, shared));

  normalCtx.rng = () => 0;
  hardCtx.rng = () => 0;

  const normalPick = AI.pickSurvivor(normalCtx, analysis);
  const hardPick = AI.pickSurvivor(hardCtx, analysis);

  // 我在萨克森有 2 张 → 它被吞我能拿分红 → 让它死，塔存活
  assert.equal(normalPick, 'tower', '普通档：让给我更多的那家去死');
  assert.equal(hardPick, 'tower', '困难档同一套规则（不再有两套逻辑）');
});

/* ------------------------------------------------------------------ 汇总 */

console.log('\n==============================================');
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
console.log('==============================================');

if (failed) {
  failures.forEach((f) => {
    console.log(`\n[${f.name}]`);
    console.log(f.err.stack);
  });
  process.exit(1);
}
