/* ==========================================================================
   生涯与成就单元测试

   career.js 依赖 localStorage，这里用内存假实现。
     node tests/career.test.js
   ========================================================================== */

const store = Object.create(null);
globalThis.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; },
};

require('../js/career.js');
const C = globalThis.Career;

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

const tierOf = (res, id) => (res.newly.find((x) => x.id === id) || {}).tier;

/* ---------------------------------------------------------------- 结构 */

{
  eq(C.ACHIEVEMENTS.length, 30, '成就总数 = 30');

  const cats = {};
  C.ACHIEVEMENTS.forEach((a) => { cats[a.cat] = (cats[a.cat] || 0) + 1; });
  eq(cats, { wealth: 7, build: 9, mind: 2, challenge: 12 }, '四类数量：7 / 9 / 2 / 12');

  const ids = C.ACHIEVEMENTS.map((a) => a.id);
  eq(new Set(ids).size, 30, '成就 id 无重复');
}

/* ---------------------------------------------------------------- 记账 */

{
  C.resetAll();
  C.startMatch();

  C.note('found', { companyId: 'a' });
  C.note('found', { companyId: 'b' });
  eq(C.getMatch().founders, 2, 'note(found)：创立 2 家');

  C.note('trigger', { count: 2 });
  C.note('trigger', { count: 4 });
  eq(C.getMatch().triggers, 2, 'note(trigger)：触发 2 次');
  eq(C.getMatch().maxCompanies, 4, 'note(trigger)：最多 4 家一起并购');

  C.note('buy', { companyId: 'a', held: 3, shares: 3 });
  C.note('buy', { companyId: 'a', held: 6, shares: 3 });
  eq(C.getMatch().buys, 2, 'note(buy)：买入 2 次');
  eq(C.getMatch().buyShares, 6, 'note(buy)：共买 6 张');
  eq(C.getMatch().maxSingleStock, 6, 'note(buy)：单公司持股峰值 6');
  eq(Object.keys(C.getMatch().buyCompanies), ['a'], 'note(buy)：只买过 1 家公司');

  C.note('stockDispose', { sell: 3, swap: 2, keep: 1, cashout: 12000 });
  eq(C.getMatch().sell, 3, 'note(stockDispose)：套现 3 张');
  eq(C.getMatch().maxCashout, 12000, 'note(stockDispose)：单次套现 12000');

  C.note('dividend', { amount: 4000, solo: true });
  eq(C.getMatch().dividends, 4000, 'note(dividend)：本局分红');
  eq(C.getMatch().soloDividends, 1, 'note(dividend)：独角戏 1 次');
  eq(C.load().cumDividend, 4000, 'note(dividend)：生涯累计分红');

  C.note('edge');
  C.note('sleight');
  C.note('broke');
  C.note('worstDividend');
  C.note('autoPlay');
  eq(C.getMatch().edge, 1, 'note(edge)');
  eq(C.getMatch().sleight, 1, 'note(sleight)');
  eq(C.getMatch().brokeTurns, 1, 'note(broke)');
  eq(C.getMatch().worstDividend, 1, 'note(worstDividend)');
  eq(C.getMatch().autoPlays, 1, 'note(autoPlay)');
}

/* ---------------------------------------------------------------- 全胜一局 */

{
  const res = C.finishMatch({
    rank: 1,
    net: 52000,
    rounds: 24,
    difficulty: 'hard',
    players: 4,
    myCash: 52000,
    secondCash: 40000,
    sumOthersCash: 90000,
    minCash: 6200,
    zeroStock: false,
    rushEnding: false,
    sevenHold: false,
  });

  eq(tierOf(res, 'firstGold'), 'Ⅰ', '第一桶金：1 场');
  eq(tierOf(res, 'tycoon'), 'Ⅰ', '华尔街大亨：5.2 万');
  eq(tierOf(res, 'harvest'), 'Ⅰ', '精准收割：独角戏 1 次');
  eq(tierOf(res, 'oligarch'), 'Ⅰ', '寡头垄断：领先 30% → Ⅰ');
  eq(tierOf(res, 'photo'), undefined, '毫厘之差：差 12000 太大 → 不解锁');
  eq(tierOf(res, 'upstart'), 'Ⅰ', '暴发户：套现 12000');
  eq(tierOf(res, 'founder'), 'Ⅰ', '白手起家：2 家');
  eq(tierOf(res, 'mergerKing'), undefined, '并购狂魔：2 次 < 3 → 不解锁');
  eq(tierOf(res, 'multiMerge'), 'Ⅲ', '多管齐下：最多 4 家 → Ⅲ');
  eq(tierOf(res, 'shareHoard'), undefined, '财迷心窍：6 张 < 30 → 不解锁');
  eq(tierOf(res, 'edge'), 'Ⅰ', '极限卡位');
  eq(tierOf(res, 'sleight'), 'Ⅰ', '空手套白狼');
  eq(tierOf(res, 'dragon'), undefined, '屠龙勇士：困难 1 胜 < 10 → 不解锁');
  eq(tierOf(res, 'blitz'), 'Ⅱ', '闪电战：24 回合 → Ⅱ');
  eq(tierOf(res, 'miser'), undefined, '铁公鸡：需要 2 次，本局只有 1 次 → 不解锁');
  eq(C.load().stingyWins, 1, '铁公鸡：计数已 +1');
  eq(tierOf(res, 'timeoutHero'), 'Ⅰ', '你们怎么不动啊：1 次');
  eq(tierOf(res, 'workerKing'), undefined, '打工皇帝：手里还有股票 → 不解锁');
  eq(tierOf(res, 'allIn'), 'Ⅰ', '梭哈：只买过 1 家且夺冠');
  eq(tierOf(res, 'poorSoul'), undefined, '大冤种：1 次 < 10 → 不解锁');
}

/* ---------------------------------------------------------------- 毫厘之差 */

{
  C.resetAll();
  C.startMatch();
  const r1 = C.finishMatch({
    rank: 1, net: 30000, rounds: 40, difficulty: 'normal', players: 3,
    myCash: 30000, secondCash: 29600, sumOthersCash: 50000,
    minCash: 9000, zeroStock: false, rushEnding: false, sevenHold: false,
  });
  eq(tierOf(r1, 'photo'), 'Ⅱ', '毫厘之差：差 400 → Ⅱ');

  C.startMatch();
  const r2 = C.finishMatch({
    rank: 1, net: 31000, rounds: 41, difficulty: 'normal', players: 3,
    myCash: 31000, secondCash: 30950, sumOthersCash: 50000,
    minCash: 9000, zeroStock: false, rushEnding: false, sevenHold: false,
  });
  eq(C.load().unlocked.photo, 3, '毫厘之差：升到最高档 Ⅲ');
  eq(tierOf(r2, 'photo'), 'Ⅲ', '毫厘之差：差距更小 → 升级到 Ⅲ');
}

/* ---------------------------------------------------------------- 打工皇帝 + 资本大鳄 */

{
  C.resetAll();
  C.startMatch();
  C.note('buy', { companyId: 'a', held: 5, shares: 5 });

  const res = C.finishMatch({
    rank: 1, net: 40000, rounds: 22, difficulty: 'normal', players: 5,
    myCash: 40000, secondCash: 20000, sumOthersCash: 60000,
    minCash: 7000, zeroStock: true, rushEnding: true, sevenHold: true,
  });

  eq(tierOf(res, 'workerKing'), 'Ⅰ', '打工皇帝：0 张股票夺冠');
  eq(tierOf(res, 'sevenHold'), undefined, '资本大鳄：需要 5 局，本局只有 1 局 → 不解锁');
  eq(C.load().sevenHoldCount, 1, '资本大鳄：计数已 +1');
  eq(C.load().rushCount, 1, '乱世求生：计数 +1（1 次还不够 3 次）');
}

/* ---------------------------------------------------------------- 连胜 / 连败 */

{
  C.resetAll();
  const win = () => C.finishMatch({
    rank: 1, net: 20000, rounds: 40, difficulty: 'normal', players: 4,
    myCash: 20000, secondCash: 15000, sumOthersCash: 40000,
    minCash: 5000, zeroStock: false, rushEnding: false, sevenHold: false,
  });
  const lose = () => C.finishMatch({
    rank: 4, net: 5000, rounds: 40, difficulty: 'normal', players: 4,
    myCash: 5000, secondCash: 20000, sumOthersCash: 40000,
    minCash: 1000, zeroStock: false, rushEnding: false, sevenHold: false,
  });

  C.startMatch(); win();
  C.startMatch(); const r2 = win();
  eq(tierOf(r2, 'wolfStreet'), 'Ⅰ', '华尔街之狼：两连胜 → Ⅰ');

  C.startMatch(); lose();
  C.startMatch(); const r4 = lose();
  eq(tierOf(r4, 'underdog'), 'Ⅰ', '贝肯街之犬：两连败 → Ⅰ');
  eq(C.load().winStreak, 0, '连胜被中断后归零');
}

/* ---------------------------------------------------------------- 零并购 + 剁手 */

{
  C.resetAll();
  C.startMatch();
  for (let i = 0; i < 5; i++) C.note('broke', {});
  const res = C.finishMatch({
    rank: 2, net: 20000, rounds: 20, difficulty: 'normal', players: 4,
    myCash: 20000, secondCash: 30000, sumOthersCash: 60000,
    minCash: 800, zeroStock: false, rushEnding: false, sevenHold: false,
  });

  eq(tierOf(res, 'peaceLove'), 'Ⅰ', '爱的国度：零并购 1 次');
  eq(tierOf(res, 'brokeBuyer'), 'Ⅰ', '剁手党：5 回合买不起 → Ⅰ');
  eq(C.load().brokeBest, 1, '剁手党：记录最高档');
}

/* ---------------------------------------------------------------- 面板 */

{
  const sum = C.summaryForPanel();
  ok(typeof sum.games === 'number', '面板：总局数');
  ok(sum.recent.length <= 20, '面板：最近排名最多 20 条');
  eq(typeof sum.unlocked, 'object', '面板：解锁表存在');
}

/* ---------------------------------------------------------------- 进度文案 */

{
  C.resetAll();
  C.startMatch();
  C.note('trigger', { count: 3 });
  C.note('trigger', { count: 6 });      // 单局最多 6 次
  C.note('buy', { companyId: 'a', held: 2, shares: 2 });

  const res = C.finishMatch({
    rank: 1, net: 20000, rounds: 22, difficulty: 'normal', players: 4,
    myCash: 20000, secondCash: 19000, sumOthersCash: 40000,
    minCash: 7000, zeroStock: true, rushEnding: false, sevenHold: false,
  });

  eq(C.progressOf('mergerKing'), '当前最高 2 次/局', '进度：单局类显示「当前最高」');
  eq(C.progressOf('multiMerge'), '当前进度 6 家', '进度：多管齐下记的是同时几家');
  eq(C.progressOf('workerKing'), '当前进度 1 次', '进度：累计类显示「当前进度」');
  eq(C.progressOf('blitz'), '当前最好 22 回合', '进度：越小越好显示「当前最好」');
  eq(C.progressOf('photo'), '当前最好 1000', '进度：毫厘之差记录最小差距');
  eq(C.progressOf('oligarch'), '', '进度：寡头垄断未达标时不显示');
  eq(C.progressOf('nonexistent'), '', '进度：未知 id 返回空串');
  eq(C.progressOf('tycoon'), '当前进度 20000', '进度：金额类不带 $ 前缀也能读');
}

/* ---------------------------------------------------------------- 对局记录 */

{
  C.resetAll();

  const makeFrame = (round, cash) => ({
    round: round,
    turn: 0,
    board: { '0,0': 'saxony' },
    players: [{ cash: cash, stocks: { saxony: round } }],
    shares: { saxony: 25 - round },
    events: round === 3 ? ['merge'] : [],
  });

  C.startMatch();
  C.recordFrame(makeFrame(1, 6000));
  C.recordFrame(makeFrame(2, 6200));
  C.recordFrame(makeFrame(3, 7000));

  const res = C.finishMatch({
    rank: 1, net: 7000, rounds: 3, difficulty: 'normal', players: 2,
    myCash: 7000, secondCash: 5000, sumOthersCash: 5000,
    minCash: 6000, zeroStock: false, rushEnding: false, sevenHold: false,
    mode: 'classic', names: ['甲', '乙'], humans: [0], ranks: [0, 1],
  });

  const list = C.replays();
  eq(list.length, 1, '对局记录：一局存一条');
  eq(list[0].frames.length, 3, '对局记录：三帧');
  eq(list[0].names, ['甲', '乙'], '对局记录：保存玩家名');
  eq(list[0].ranks, [0, 1], '对局记录：保存名次序列');
  eq(list[0].frames[2].events, ['merge'], '对局记录：保存事件标记');
  eq(list[0].frames[2].players[0].cash, 7000, '对局记录：保存每帧现金');

  const one = C.replay(list[0].id);
  eq(one && one.frames.length, 3, '对局记录：按 id 取回');

  C.removeReplay(list[0].id);
  eq(C.replays().length, 0, '对局记录：可以删除');
}

/* ---------------------------------------------------------------- 只保留 10 局 */

{
  C.resetAll();
  for (let g = 0; g < 12; g++) {
    C.startMatch();
    C.recordFrame({
      round: 1, turn: 0, board: {}, players: [{ cash: 6000, stocks: {} }],
      shares: {}, events: [],
    });
    C.finishMatch({
      rank: 1, net: 6000, rounds: 1, difficulty: 'normal', players: 2,
      myCash: 6000, secondCash: 5000, sumOthersCash: 5000,
      minCash: 6000, zeroStock: false, rushEnding: false, sevenHold: false,
      mode: 'classic', names: ['甲', '乙'], humans: [0], ranks: [0, 1],
    });
  }
  eq(C.replays().length, 10, '对局记录：最多保留 10 局');

  // 每条都带版本号，便于将来判断能否回放
  eq(typeof C.replays()[0].version, 'string', '对局记录：带版本号');
}

/* ---------------------------------------------------------------- 输出 */

console.log('');
failures.forEach((f) => console.log('  ✗ ' + f));
if (failures.length) console.log('');
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(46));
if (fail > 0) process.exitCode = 1;
