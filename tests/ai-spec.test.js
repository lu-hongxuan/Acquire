/* ==========================================================================
   出牌规则不变量 · 从《规则书》推导，不是从实现推导

   规则书 二、回合流程：
     "每回合严格按以下顺序执行，不可跳过或调换
      第一步：放置1块建筑板块"
   推论：**只要手里存在合法可放的牌，AI 就必须返回一块，永远不能返回 null。**

   这个文件存在的意义：
     上一版实现过「AI 因为要买股而整回合不放牌」，当时的单元测试还断言
     `pickTile === null` 并且通过 —— 那是「按实现写测试」的典型错误。
     这里改为按规则写测试：不管 AI 想做什么，只要还有合法牌就必须出牌。
   ========================================================================== */

const assert = require('assert');
const path = require('path');
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed += 1; console.log('  ✓ ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  ✗ ' + name); }
}

function row(id, n, r) {
  const o = {};
  for (let i = 0; i < n; i++) o[i + ',' + r] = id;
  return o;
}

function ctxOf(opts) {
  const board = Object.assign({}, opts.board || {});
  const game = { board, players: [], founded: {} };
  Object.keys(board).forEach((k) => { game.founded[board[k]] = true; });

  const players = (opts.players || []).map((p, i) => ({
    index: i, cash: p.cash, stocks: Object.assign(Object.create(null), p.stocks || {}),
  }));
  game.players = players;

  const PRICE = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
  const STEPS = [[41, 8], [31, 7], [21, 6], [11, 5], [6, 4], [5, 3], [4, 2], [3, 1], [2, 0]];
  const stepOf = (s) => (s < 2 ? null : STEPS.find(([m]) => s >= m)[1]);
  const priceOf = (s) => PRICE[stepOf(s)];
  const payouts = (s) => {
    const p = priceOf(s);
    return p ? { first: p * 10, second: p * 5, third: 0 } : null;
  };

  return {
    E, game,
    meIdx: opts.meIdx || 0,
    me: players[opts.meIdx || 0],
    players,
    canSeeHoldings: true,
    mode: 'classic',
    sizes: opts.sizes || {},
    hand: opts.hand || [],
    shares: opts.shares || {},
    priceOf, payouts,
    rankHolders: (id) => E.rankHolders(game, id),
    computeDividends: E.computeDividends,
    difficulty: opts.difficulty || 'hard',
    round: opts.round || 5,
    rng: () => 0,
  };
}

console.log('\n【出牌不变量】');

test('只要还有合法牌，就绝不允许返回 null', () => {
  /* 构造一个「并购牌 + 普通牌」的局面 —— 正是当初被跳过放牌的场景 */
  const ctx = ctxOf({
    players: [
      { cash: 6000, stocks: { saxony: 1 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: Object.assign(
      {},
      row('saxony', 3, 0),
      { '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower' }
    ),
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1]],
  });

  const pick = AI.pickTile(ctx);
  assert.notStrictEqual(pick, null, '有合法牌时必须出牌');
});

test('连续 20 回合，任何回合都不返回 null（只要手里有牌）', () => {
  const ctx = ctxOf({
    players: [
      { cash: 6000, stocks: { saxony: 1 } },
      { cash: 6000, stocks: { saxony: 2 } },
    ],
    board: Object.assign(
      {},
      row('saxony', 3, 0),
      { '0,2': 'tower', '1,2': 'tower', '2,2': 'tower', '3,2': 'tower' }
    ),
    sizes: { saxony: 3, tower: 4 },
    shares: { saxony: 20, tower: 20 },
    hand: [[2, 1], [10, 8], [11, 7]],
  });

  for (let i = 0; i < 20; i++) {
    const pick = AI.pickTile(ctx);
    assert.notStrictEqual(pick, null, '第 ' + (i + 1) + ' 次调用返回了 null');
  }
});

// spec-allowed-null：本文件专门验证「无牌可放」这一条规则
test('手里确实没有合法牌时，才允许返回 null', () => {
  const ctx = ctxOf({
    players: [{ cash: 6000, stocks: {} }],
    board: { '0,0': 'saxony', '1,0': 'saxony' },
    sizes: { saxony: 2 },
    hand: [[0, 0]],          // 这一格已经有牌 → 唯一的手牌不合法
  });
  assert.strictEqual(AI.pickTile(ctx), null);
});

console.log('\n通过 ' + passed + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('\n[' + f.name + ']\n' + f.e.stack));
  process.exit(1);
}
