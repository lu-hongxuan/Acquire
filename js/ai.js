/**
 * 《并购风云》AI 对手
 * 设计依据见 AI规则.md
 *
 * 对外只暴露四个决策函数，难度只改实现，不改主流程：
 *   pickTile(ctx)                 → [c, r] | null      打哪块牌
 *   pickSurvivor(ctx, analysis)   → companyId          平局时谁存活
 *   pickStock(ctx, opts)          → { swaps, rest }    被吞并公司的股票怎么处置
 *   pickBuys(ctx)                 → [companyId, ...]   买哪几张股票
 *
 * ctx 由 board.js 组装，字段见文件末尾的说明。
 */
(function (root) {
  'use strict';

  const SAFE_SIZE = 11;

  /* ------------------------------------------------------------ 小工具 */

  function rng() { return Math.random(); }

  function randomOf(list) {
    return list[Math.floor(rng() * list.length)];
  }

  /** 在分数接近的候选里随机挑一个，免得每局都一模一样 */
  function pickBest(list, key) {
    if (!list.length) return null;
    const sorted = list.slice().sort((a, b) => key(b) - key(a));
    const top = key(sorted[0]);
    const near = sorted.filter((x) => key(x) >= top - 0.001);
    return randomOf(near);
  }

  /* -------------------------------------------------------- 棋盘地理信息 */

  /**
   * 每家公司的「生长空间」与「并购缺口」。
   *   room = 相邻空格总数（还能长多大）
   *   gaps = 相邻空格里，同时邻接**其他公司**的格子数（差几块会被并购）
   */
  function buildGeo(ctx) {
    const E = ctx.E;
    const board = ctx.game.board;
    const geo = {};
    const seen = {};

    Object.keys(ctx.sizes).forEach((id) => {
      geo[id] = { room: 0, gaps: 0, size: 0 };
      seen[id] = new Set();
    });

    for (const kk in board) {
      const v = board[kk];
      if (typeof v !== 'string') continue;
      if (!geo[v]) { geo[v] = { room: 0, gaps: 0, size: 0 }; seen[v] = new Set(); }
      geo[v].size++;

      const parts = kk.split(',');
      const c = Number(parts[0]);
      const r = Number(parts[1]);

      for (const [nc, nr] of E.neighbors(c, r)) {
        const nk = E.key(nc, nr);
        if (board[nk] !== undefined) continue;      // 已占用：公司板块或零散板块
        if (seen[v].has(nk)) continue;
        seen[v].add(nk);
        geo[v].room++;

        let touchesOther = false;
        for (const [tc, tr] of E.neighbors(nc, nr)) {
          const tv = board[E.key(tc, tr)];
          if (typeof tv === 'string' && tv !== v) { touchesOther = true; break; }
        }
        if (touchesOther) geo[v].gaps++;
      }
    }

    return geo;
  }

  /* ---------------------------------------------------------- 收益估算 */

  /** 若某公司此刻被吞并，我能拿多少分红 */
  function myDividend(ctx, companyId, playerIdx) {
    const size = ctx.sizes[companyId] || 0;
    if (size < 2) return 0;
    const pay = ctx.payouts(size, companyId);
    const groups = ctx.rankHolders(companyId);
    if (!groups.length) return 0;
    const dist = ctx.computeDividends(ctx.mode, groups, pay);
    return dist[playerIdx] || 0;
  }

  /** 某公司此刻被吞并，指定玩家能拿多少分红 */
  function dividendFor(ctx, companyId, playerIdx) {
    return myDividend(ctx, companyId, playerIdx);
  }

  /** 别人在这家公司持有多少张 */
  function rivalShares(ctx, companyId) {
    let n = 0;
    ctx.players.forEach((p, i) => {
      if (i === ctx.meIdx) return;
      n += p.stocks[companyId] || 0;
    });
    return n;
  }

  /** 我在这家公司的持股名次（1 = 第一），没持股返回 99 */
  function myRank(ctx, companyId) {
    const groups = ctx.rankHolders(companyId);
    for (let g = 0; g < groups.length; g++) {
      for (const h of groups[g]) {
        if (h.player === ctx.meIdx) return g + 1;
      }
    }
    return 99;
  }

  /** 某公司第一名持股数 */
  function topCount(ctx, companyId) {
    const groups = ctx.rankHolders(companyId);
    return groups.length ? groups[0][0].count : 0;
  }

  /* ------------------------------------------------------ 难度档案 */

  /*
   * 三档难度的差异，全部收敛到这张表。
   *
   * 以前是在六个函数里各写一次 `ctx.difficulty === 'easy'`，
   * 加第四档时得挨个改；现在只改这里。
   * 每个字段都对应原来的一处分支，行为完全一致。
   */
  /*
   * 记忆与性格模块。浏览器里挂在 window 上，Node 测试走 require。
   * 拿不到就当没有 —— 困难档退化成「会战术但不记事」，不会崩。
   */
  const Memory = (typeof AIMemory !== 'undefined' && AIMemory)
    || (typeof require === 'function' ? require('./ai-memory.js') : null);

  /** 每个 AI 一份「脑子」：记忆 + 性格。按座次存，新局清空 */
  const brains = Object.create(null);

  function brainOf(ctx) {
    const idx = ctx.meIdx;
    if (!brains[idx]) {
      brains[idx] = {
        mem: Memory ? Memory.create(idx) : null,
      };
    }
    return brains[idx];
  }

  function resetBrains() {
    Object.keys(brains).forEach((k) => { delete brains[k]; });
  }

  const PROFILE = {
    easy: {
      randomSurvivor: true,    // 平局随便挑一个
      seeHoldings: false,      // 不看对手持股（也就不会防资敌）
      delayHarvest: false,     // 不做局
      randomTile: true,        // 随手打一张
      tactics: false,          // 不做伤害规避、不抢将死公司
      randomStock: true,       // 股票处置也随机
      simpleStock: false,
      easyBias: true,          // 买股分一律 +20
      safeCash: 0,             // 不留安全现金
    },
    normal: {
      randomSurvivor: false,
      seeHoldings: true,
      delayHarvest: true,      // 会做局（原困难能力，下放到普通）
      randomTile: false,
      tactics: true,           // 伤害规避 + 抢将死公司
      randomStock: false,
      simpleStock: false,      // 处置也走净期望
      easyBias: false,
      safeCash: 800,
      brain: false,            // 但不记事、不看性格
    },
    hard: {
      randomSurvivor: false,
      seeHoldings: true,
      delayHarvest: true,      // 会做局
      randomTile: false,
      tactics: true,           // 伤害规避 + 抢将死公司
      randomStock: false,
      simpleStock: false,
      easyBias: false,
      safeCash: 800,
      brain: true,             // 记忆 + 性格
    },
  };

  /** 取当前难度的档案；未知难度按普通处理 */
  function P(ctx) {
    return PROFILE[ctx && ctx.difficulty] || PROFILE.normal;
  }

  /**
   * 困难档每次决策前先「看一眼牌桌」。
   * 只取记忆需要的那几项：持股、排行、哪些公司还活着、回合数。
   */
  function observeBrain(ctx) {
    const brain = brainOf(ctx);
    if (!brain.mem || !Memory) return brain;

    /*
     * 记录「哪些公司出现过」。
     * 这是「前期」判定的唯一依据：所有 7 家都出现过之后才进入非前期。
     */
    brain.mem.seen = brain.mem.seen || {};
    (ctx.E.foundedCompanies(ctx.game) || []).forEach((id) => {
      brain.mem.seen[id] = true;
    });

    const holders = {};
    const founded = ctx.E.foundedCompanies(ctx.game);
    const alive = {};
    founded.forEach((id) => {
      holders[id] = ctx.rankHolders(id).reduce((acc, g) => acc.concat(g), []);
      if (holders[id].length) alive[id] = true;
    });

    Memory.update(brain.mem, {
      round: ctx.round || 0,
      meIdx: ctx.meIdx,
      players: ctx.players,
      holders: holders,
      alive: alive,
    });

    return brain;
  }

  /** 我的现金是不是全场第一（终局判断用） */
  function iAmCashLeader(ctx) {
    const mine = ctx.me.cash || 0;
    return ctx.players.every((p, i) => i === ctx.meIdx || (p.cash || 0) <= mine);
  }

  /* ------------------------------------------------------ 存活方选择 */

  /** 平局时选谁存活 */
  /**
   * 平局时选谁存活。
   *
   * 玩家的原话：让「能给我更多分红的那家公司」去死（我拿大头）。
   * 所以先把「让某家去死，我能拿多少」算出来，再让最多的那家去死。
   *
   * 只有 2/3 概率照此执行 —— 剩下 1/3 完全随机，
   * 否则人类玩家几局就能摸清规律。
   */
  function pickSurvivor(ctx, analysis) {
    const cands = (analysis.largest && analysis.largest.length)
      ? analysis.largest
      : [analysis.companies[0]];

    if (cands.length === 1) return cands[0];

    // 随机源可注入（测试用），默认 Math.random
    const rand = (ctx && typeof ctx.rng === 'function') ? ctx.rng : rng;
    const pickOne = (list) => list[Math.floor(rand() * list.length) % list.length];

    if (P(ctx).randomSurvivor) return pickOne(cands);   // 简单档：纯随机

    /** 如果让 id 这家去死，我能拿到多少（分红 + 持股价值变化） */
    const deathGain = (id) => {
      const size = ctx.sizes[id] || 0;
      const price = ctx.priceOf(size, id) || 0;
      return dividendFor(ctx, id, ctx.meIdx) + (ctx.me.stocks[id] || 0) * price * 0.4;
    };

    const scored = cands.map((id) => ({ id, gain: deathGain(id) }));
    scored.sort((a, b) => b.gain - a.gain);

    const best = scored[0];
    const second = scored[1];
    if (!best) return cands[0];
    if (!second || Math.abs(best.gain - second.gain) < 1) {
      return pickOne(cands);           // 两边一样 → 随机
    }

    if (rand() < 2 / 3) {
      // 让「给我最多」的那家去死 → 存活方是另一个候选
      const survivor = cands.filter((id) => id !== best.id);
      return pickOne(survivor.length ? survivor : cands);
    }
    return pickOne(cands);
  }

  /* ---------------------------------------------------------- 出牌决策 */

  function candidates(ctx) {
    const out = [];
    for (const [c, r] of ctx.hand) {
      const a = ctx.E.analyzePlacement(ctx.game, c, r);
      if (a.valid) out.push({ c, r, a });
    }
    return out;
  }

  /** 打出去会让某个对手大赚、而自己几乎没好处 */
  function isHarmful(ctx, tile) {
    if (tile.a.type !== 'merger') return false;
    if (!ctx.canSeeHoldings) return false;   // 看不到持股就无法判断，交给普通档

    const survivor = pickSurvivor(ctx, tile.a);
    const mine = mergerGain(ctx, tile.a, survivor, ctx.meIdx);
    let rivalMax = 0;
    ctx.players.forEach((p, i) => {
      if (i === ctx.meIdx) return;
      rivalMax = Math.max(rivalMax, mergerGain(ctx, tile.a, survivor, i));
    });

    return mine < 200 && rivalMax > 1500;
  }

  /** 某次并购对指定玩家的总收益（分红 + 持股价值变化） */
  function mergerGain(ctx, analysis, survivor, playerIdx) {
    const p = ctx.players[playerIdx];
    let gain = 0;

    for (const id of analysis.companies) {
      const size = ctx.sizes[id] || 0;
      if (id === survivor) {
        gain += (p.stocks[id] || 0) * ctx.priceOf(size, id) * 0.3;
      } else {
        gain += dividendFor(ctx, id, playerIdx);
        gain += (p.stocks[id] || 0) * ctx.priceOf(size, id) * 0.4;
      }
    }
    return gain;
  }

  /**
   * 终局判断：这一手会不会把某家公司推到 41 块。
   * 领先的人希望早点结束，落后的人绝对不干 —— 这是旧 AI 最蠢的地方。
   */
  function endgameBias(ctx, afterSize) {
    if (!(afterSize >= 41)) return 0;
    return iAmCashLeader(ctx) ? 60 : -200;
  }

  function scoreTile(ctx, tile) {
    const a = tile.a;
    const me = ctx.meIdx;
    let s = 0;

    if (a.type === 'found') {
      // 当创始人白拿 1 张创始人股
      s += a.canFound ? 46 : 6;
      // 规模大的零散片区更值钱
      if (a.canFound) s += Math.min(a.groupSize || 0, 5) * 3;
      return s;
    }

    if (a.type === 'expand') {
      const id = a.companyId;
      const mine = ctx.me.stocks[id] || 0;
      const gain = a.sizeGain || 1;

      s += mine * 6.5;              // 我持股多，就希望它长大
      s += gain * 5;                // 一次吞掉零散板块更划算

      // 别帮对手做大
      if (P(ctx).seeHoldings && ctx.canSeeHoldings) {
        s -= rivalShares(ctx, id) * 2.4;
      }

      // 快接近安全规模时，扩张的意义会变化（股价继续涨，但不能再被吞并）
      const after = (ctx.sizes[id] || 0) + gain;
      if (mine > 0 && after >= SAFE_SIZE) s += 12;

      /* 困难档：会算「这一手会不会直接结束游戏 / 把对手喂成安全公司」 */
      if (P(ctx).brain) {
        s += endgameBias(ctx, after);
        if (after >= SAFE_SIZE && mine === 0) s -= 40;   // 把对手推成安全公司，纯属资敌
      }
      return s;
    }

    if (a.type === 'merger') {
      const survivor = pickSurvivor(ctx, a);
      const survPrice = ctx.priceOf((ctx.sizes[survivor] || 0) + 1, survivor);

      for (const id of a.companies) {
        if (id === survivor) continue;
        const size = ctx.sizes[id] || 0;
        // 我被吞并：拿分红
        s += dividendFor(ctx, id, me) * 0.55;
        // 我在这家持股，股票可以套现或换股
        s += (ctx.me.stocks[id] || 0) * ctx.priceOf(size, id) * 0.35;
      }

      s += (ctx.me.stocks[survivor] || 0) * survPrice * 0.3;

      /* 困难档：并购会让存活方直接冲到 41 块时，也要看是谁在收尾 */
      if (P(ctx).brain) {
        const merged = (ctx.sizes[survivor] || 0) + 1;
        s += endgameBias(ctx, merged);
      }

      if (P(ctx).seeHoldings && ctx.canSeeHoldings) {
        let rivalMax = 0;
        ctx.players.forEach((p, i) => {
          if (i === me) return;
          rivalMax = Math.max(rivalMax, mergerGain(ctx, a, survivor, i));
        });
        s -= rivalMax * 0.5;
      }
      return s;
    }

    // 孤立放置：几乎没价值
    return 2;
  }

  /**
   * 「做局」：手里有一块能收割自己持股较多的公司，但还没拿够筹码
   * → 先打别的牌，这一手先买股票。
   */
  function shouldDelayHarvest(ctx, tile, all) {
    if (!P(ctx).delayHarvest) return false;
    if (tile.a.type !== 'merger') return false;

    const survivor = pickSurvivor(ctx, tile.a);
    const loser = tile.a.companies.find((id) => id !== survivor);
    if (!loser) return false;

    const myShares = ctx.me.stocks[loser] || 0;
    const mine = myRank(ctx, loser);          // 1 = 已是大股东
    const size = ctx.sizes[loser] || 0;
    const geo = ctx.geo[loser] || { gaps: 99 };

    // 已经是大股东，或者公司太小，就没必要拖
    if (mine === 1) return false;
    if (size < 3) return false;
    if (geo.gaps > 1) return false;

    // 还能买得起至少 2 张、且买完有机会追平第一 → 值得先拖一手
    const need = Math.max(0, topCount(ctx, loser) + 1 - myShares);
    const price = ctx.priceOf(size, loser);
    const affordable = Math.floor((ctx.me.cash * 0.45) / Math.max(price, 1));

    if (need === 0 || need > 3) return false;
    if (affordable < need) return false;

    // 必须还有别的牌可以打
    return all.some((t) => t !== tile && t.a.type !== 'merger');
  }

  /** 返回 [c, r]，没有可打的牌就返回 null */
  function pickTile(ctx) {
    ctx.geo = ctx.geo || buildGeo(ctx);
    const all = candidates(ctx);
    if (!all.length) return null;

    const asPair = (t) => (t ? [t.c, t.r] : null);

    if (P(ctx).randomTile) {
      return asPair(randomOf(all));
    }

    const brain = P(ctx).brain ? brainOf(ctx) : null;

    /*
     * 上一回合「藏」下来的并购牌。
     *   force       → 无论买没买到，这一手**必打**
     *   conditional → 现在打出去能拿分红才打；拿不到就继续藏着
     * 牌已经不在手里（被弃/被用）就直接清掉标记。
     */
    if (brain && brain.mem && brain.mem.savedTile) {
      const p = brain.mem.savedTile;
      const t = all.find((x) => x.c === p.c && x.r === p.r);

      if (!t) {
        delete brain.mem.savedTile;
      } else if (p.mode === 'force') {
        delete brain.mem.savedTile;
        return asPair(t);
      } else if (p.mode === 'conditional') {
        if (dividendOfMe(ctx, p.loserId) > 0) {
          delete brain.mem.savedTile;
          return asPair(t);
        }
        /*
         * 还是拿不到分红 → 说明有人在卡他。
         * 不拒绝出牌，而是给这张牌加负权重并记下来，直到局势变化。
         */
        delete brain.mem.savedTile;
        t.holdThisTurn = true;
        markTile(ctx, t, p.loserId, -300);
      }
    }

    /*
     * 并购评估：这一回合要不要打这张并购牌（四分支）。
     *
     * 分支 1/3 会把这张牌记进 savedTile（藏牌），下一回合由上面的逻辑取用；
     * 分支 2 立刻打；分支 4 只是这回合不打它。
     * 无论哪个分支，**这一回合仍然要放一块牌**（放牌阶段不可跳过）。
     */
    if (brain && brain.mem) {
      const playNow = [];

      for (const t of all) {
        if (t.a.type !== 'merger') continue;
        if (t.holdThisTurn) continue;

        const d = mergerDeferDecision(ctx, t);
        if (!d) continue;

        /*
         * 分支 1 / 3：藏牌 + 买股，记为 savedTile
         * 分支 2：现在能拿分红，但再追也追不上 → **直接打**
         * 分支 4：拿不到分红且差距太大 → 这回合别打它
         */
        if (d.action === 'force' || d.action === 'conditional') {
          brain.mem.savedTile = {
            c: t.c,
            r: t.r,
            loserId: d.loserId,
            mode: d.action === 'force' ? 'force' : 'conditional',
          };
          t.holdThisTurn = true;
        } else if (d.action === 'play') {
          playNow.push(t);
        } else if (d.action === 'abandon') {
          // 藏牌 + 打上负权重，直到局势变化
          t.holdThisTurn = true;
          markTile(ctx, t, d.loserId, -300);
        }
      }

      // 分支 2：判定「现在就打」，直接打这张
      if (playNow.length) {
        return asPair(pickBest(
          playNow.map((t) => ({ t, score: scoreTile(ctx, t) })),
          (x) => x.score
        ).t);
      }
    }

    if (brain && brain.mem) pruneTileMarks(ctx);

    let scored = all.map((t) => ({
      t,
      score: scoreTile(ctx, t) + (t.scoreAdjust || 0) + tileWeight(ctx, t),
    }));

    // 先扣掉「这一手不想打」的并购牌；如果扣完没牌了，说明只能打它
    const withoutHeld = scored.filter((x) => !x.t.holdThisTurn);
    if (withoutHeld.length) {
      if (typeof window !== 'undefined' && window.BattleLog) {
        const held = scored.length - withoutHeld.length;
        if (held) window.BattleLog.add('[决策] 先放别的牌，并购牌留到下一回合');
      }
      scored = withoutHeld;
    }

    if (P(ctx).tactics) {
      // ① 伤害规避：会让对手赚大发的牌，只要还有别的选择就不打
      const safe = scored.filter((x) => !isHarmful(ctx, x.t));
      const pool = safe.length ? safe : scored;

      // ② 做局：该拖的时候先打别的
      const harvest = pool.find((x) => x.t.a.type === 'merger' && shouldDelayHarvest(ctx, x.t, all));
      if (harvest) {
        const others = pool.filter((x) => x !== harvest);
        if (others.length) return asPair(pickBest(others, (x) => x.score).t);
      }

      return asPair(pickBest(pool, (x) => x.score).t);
    }

    return asPair(pickBest(scored, (x) => x.score).t);
  }

  /* ------------------------------------------------------ 股票处置决策 */

  /**
   * opts = { loserId, survivorId, size, count, survivorShares }
   * 返回 { swaps, rest }
   */
  /**
   * 场上是否还有**能让公司重新上市**的空白块。
   *
   * 只有「两块相邻、且都不挨着任何公司」的空格才算 ——
   * 挨着公司的空格只能用来扩张，不能用来创立新公司，
   * 保留股票的收益来自「这家公司将来重新成立」，所以必须按创立条件判断。
   */
  function hasFoundableSpace(ctx) {
    /*
     * 「空白块」= 有板块、但不属于任何公司的零散板块（board 里记作 null）。
     * 只有 2 块以上连在一起的零散板块，才能用来创立一家公司
     *（被吞并公司的总部已收回托盘，所以创立位一定存在）。
     */
    const board = ctx.game.board;
    const R = 9;
    const C = 12;
    const isWild = (c, r) => board[c + ',' + r] === null;

    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (!isWild(c, r)) continue;
        if (c + 1 < C && isWild(c + 1, r)) return true;
        if (r + 1 < R && isWild(c, r + 1)) return true;
      }
    }
    return false;
  }

  /**
   * 这一手并购牌值不值得「先买股、下回合再打」。
   *
   * 玩家原话：先算这局并购我能拿多少分红。
   *   · 拿得到分红：再买几张能让我分红更多？≤3 → 先买，下一回合再打。
   *   · 拿不到分红：和「最后一个能分红的股东」差几张？≤3 → 先买再打；
   *                 >3 → 干脆别打这张牌。
   *
   * 返回 null 表示不干预（平局并购、或本来就该直接打）。
   * 返回 { defer, avoid, loserId } 交给 pickTile 处理。
   */
  /**
   * 创造并购的完整判定（玩家拆解的四分支）。
   *
   * 返回：
   *   { action: 'force',       loserId }  能拿分红 & Need≤3 → 藏牌 + 买股，下回合**必打**
   *   { action: 'conditional', loserId }  拿不到 & Need≤3 → 藏牌 + 买股，
   *                                       下回合拿得到分红才打，拿不到就这回合不打它
   *   { action: 'play' }                  能拿分红 & Need>3 → 现在就打
   *   { action: 'abandon' }               拿不到 & Need>3 → 藏牌，且不打它
   *   null                                平局并购等无关情况
   */
  /* ------------------------------------------------------ 牌的权重记忆 */

  /*
   * 「这张牌最近不能打」不是拒绝出牌，而是给它一个负权重；
   * 局势一变（我的持股变了 / 公司规模变了 / 现在能拿分红了）就清掉。
   */
  function tileKey(t) { return t.c + ',' + t.r; }

  function markTile(ctx, t, loserId, weight) {
    const brain = P(ctx).brain ? brainOf(ctx) : null;
    if (!brain || !brain.mem) return;
    brain.mem.tileMarks = brain.mem.tileMarks || {};
    brain.mem.tileMarks[tileKey(t)] = {
      loserId: loserId,
      weight: weight,
      sharesAt: ctx.me.stocks[loserId] || 0,
      sizeAt: ctx.sizes[loserId] || 0,
    };
  }

  /** 局势变了就清掉标记 */
  function pruneTileMarks(ctx) {
    const brain = P(ctx).brain ? brainOf(ctx) : null;
    if (!brain || !brain.mem || !brain.mem.tileMarks) return;

    const marks = brain.mem.tileMarks;
    Object.keys(marks).forEach((k) => {
      const m = marks[k];
      const mine = ctx.me.stocks[m.loserId] || 0;
      const size = ctx.sizes[m.loserId] || 0;
      const div = dividendOfMe(ctx, m.loserId);

      if (mine !== m.sharesAt || size !== m.sizeAt || div > 0) delete marks[k];
    });
  }

  function tileWeight(ctx, t) {
    const brain = P(ctx).brain ? brainOf(ctx) : null;
    if (!brain || !brain.mem || !brain.mem.tileMarks) return 0;
    const m = brain.mem.tileMarks[tileKey(t)];
    return m ? (m.weight || 0) : 0;
  }

  function mergerDeferDecision(ctx, tile) {
    const a = tile.a;
    if (!a || a.type !== 'merger') return null;

    const comps = a.companies || [];
    if (comps.length < 2) return null;

    const sizes = a.sizes || {};
    const maxSize = Math.max.apply(null, comps.map((id) => sizes[id] || 0));
    const largest = comps.filter((id) => (sizes[id] || 0) === maxSize);
    if (largest.length !== 1) return null;      // 平局并购：名次不变，不参与

    const survivor = largest[0];
    const losers = comps.filter((id) => id !== survivor);
    if (!losers.length) return null;

    // 多家被吞：按「我在它身上能拿多少分红」挑一家判断
    let loser = losers[0];
    let best = -1;
    losers.forEach((id) => {
      const v = dividendOfMe(ctx, id);
      if (v > best) { best = v; loser = id; }
    });

    const mine = ctx.me.stocks[loser] || 0;
    const groups = ctx.rankHolders(loser);
    const gi = myGroupIndex(ctx, loser);
    const inLine = dividendOfMe(ctx, loser) > 0;

    /*
     * NeedShares：
     *   线内 → 超过「前一名或与我并列的那组」所需张数（并列至少要 +1 独占）
     *   线外 → 挤进分红线所需张数（线内最后一名 +1）
     */
    let need = 0;
    if (inLine) {
      if (gi > 0) {
        need = groups[gi - 1][0].count + 1 - mine;
      } else if (groups[0] && groups[0].length > 1) {
        need = groups[0][0].count + 1 - mine;    // 并列第一 → 独占
      } else {
        need = 0;                                // 已经独占第一，不需要再买
      }
    } else {
      need = lineLastCount(ctx, loser) + 1 - mine;
    }

    /* 买不起就别藏牌：藏了也买不到，等于白拖一回合 */
    const unit = ctx.priceOf(sizes[loser] || 0, loser) || 0;
    const cantBuy = !(unit > 0) || (ctx.me.cash || 0) < unit;

    if (inLine) {
      if (need > 0 && need <= 3 && !cantBuy) return { action: 'force', loserId: loser, need };
      return { action: 'play', loserId: loser, need };
    }

    // 线外
    if (need <= 3 && !cantBuy) return { action: 'conditional', loserId: loser, need };
    return { action: 'abandon', loserId: loser, need };
  }

  function pickStock(ctx, opts) {
    const { loserId, survivorId, size, count, survivorShares } = opts;
    const price = ctx.priceOf(size, loserId) || 0;
    const survSize = ctx.sizes[survivorId] || 0;
    const survPrice = ctx.priceOf(survSize, survivorId) || 0;
    const maxSwaps = Math.min(Math.floor(count / 2), survivorShares);

    if (P(ctx).randomStock) {
      const roll = rng();
      if (roll < 0.2) return { swaps: 0, rest: 'sell' };
      if (roll < 0.75) return { swaps: maxSwaps, rest: 'keep' };
      return { swaps: 0, rest: 'keep' };
    }

    // 2 张被吞并方 换 1 张存活方：比较每 2 张的价值
    const perTwoSell = price * 2;
    const perTwoSwap = survPrice;

    if (P(ctx).simpleStock) {
      if (maxSwaps > 0 && perTwoSwap >= perTwoSell * 0.9) {
        return { swaps: maxSwaps, rest: 'sell' };
      }
      return { swaps: 0, rest: 'sell' };
    }

    /*
     * 玩家的保留规则（三条同时满足才成立）：
     *   ① 拿到分红后现金 > 5000
     *   ② 无法置换（存活方股票池空了，或手里不足 2 张）
     *   ③ 场上还有连在一起的空白块
     * 满足就**逐张**判断，每张 90% 保留；不是「要么全留、要么全卖」。
     */
    const cashNow = ctx.me.cash || 0;
    const canSwap = maxSwaps > 0;
    if (!P(ctx).easyBias && cashNow > 5000 && !canSwap && hasFoundableSpace(ctx)) {
      const rand = typeof ctx.rng === 'function' ? ctx.rng : rng;
      let keep = 0;
      for (let i = 0; i < count; i++) {
        if (rand() < 0.9) keep += 1;
      }
      return { swaps: 0, keep: keep, rest: keep === count ? 'keep' : 'sell' };
    }

    // 困难：算净期望，并考虑存活方股票池够不够
    if (maxSwaps > 0 && perTwoSwap >= perTwoSell) {
      return { swaps: maxSwaps, rest: 'sell' };
    }
    if (maxSwaps > 0 && survivorShares < count / 2 && perTwoSwap >= perTwoSell * 0.75) {
      return { swaps: maxSwaps, rest: 'sell' };
    }
    return { swaps: 0, rest: 'sell' };
  }

  /* ---------------------------------------------------------- 买股决策 */

  /* ---------------------------------------------------------- 买股权重表 */

  /*
   * 所有买股权重集中在这里，不散落在函数里。
   *
   * 规则出处：`_整改方案/AI难度重做设计案.md` 四·七。
   * 改数值必须同时改文档；tests/ai-spec.test.js 会检查二者的关系是否成立。
   */
  const TUNING = {
    // 保位置：前期减半，非前期满值
    defendFull: 1000,        // 持股 ≥4
    defendSmall: 800,        // 持股 <4
    // 获得更高股东：前期要高于保位，非前期与保位相当
    rankUp: 1000,
    // 已在红线之上（第一名且壁垒 ≥4）→ 继续买的意愿降低
    safeLeadPenalty: -200,
    safeLeadPenaltyFar: -150,   // 壁垒 ≥6 再扣
    // 前期反死磕
    fixationPenalty: -120,
    // 新开仓
    newPosition: 60,
  };

  // 给浏览器调试用；Node 测试环境没有 window
  if (typeof window !== 'undefined') window.__AI_TUNING = TUNING;

  /* ---------------------------------------------------------- 买股打分 */

  /*
   * 这套分数来自玩家的真实决策流程（不是设计者想象的「AI 会怎么想」）：
   *
   *   T1 护食保命  —— 我在分红线内但位置不稳，先把自己焊死
   *   T2 疯狂追分  —— 掉出分红线了，还值不值得追；以及「搭便车」
   *   T3 末日狂奔  —— 这家公司马上要被吞并，抢在结算前站位
   *   T4 常规建仓  —— 并购胜方卡位、以及最朴素的价值
   *
   * 各梯队是**叠加**的：一家公司可能既「将死」又「我在线内」。
   */

  /** 前期：还有公司没出现过（用记忆里的「见过」集合判断） */
  function isEarlyGame(ctx) {
    const brain = P(ctx).brain ? brainOf(ctx) : null;
    const total = (ctx.E.COMPANIES || []).length || 7;
    const seen = brain && brain.mem && brain.mem.seen
      ? Object.keys(brain.mem.seen).length
      : (ctx.E.foundedCompanies(ctx.game) || []).length;
    return seen < total;
  }

  /** 我上面那一组（持股比我多的最近一组）的股数；没有则 0 */
  function groupAboveCount(ctx, id) {
    const groups = ctx.rankHolders(id);
    const gi = myGroupIndex(ctx, id);
    if (gi <= 0) return 0;
    return groups[gi - 1][0].count;
  }

  /** 我在该公司的分红（>0 即在分红线内） */
  function dividendOfMe(ctx, id) {
    return dividendFor(ctx, id, ctx.meIdx);
  }

  /** 我在该公司所处的组（0 = 并列第一组）；不在榜上返回 -1 */
  function myGroupIndex(ctx, id) {
    const groups = ctx.rankHolders(id);
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].some((h) => h.player === ctx.meIdx)) return i;
    }
    return -1;
  }

  /**
   * 壁垒值：我的股数 − 后面第一组（不同股数）的股数。
   *
   * 三种边界：
   *   与我同股数的人存在 → 0（一票之差，最危险，必须算危机）
   *   后面没人比我少     → 99（从下面追不上来，不算危机）
   *   其余               → 正常差值
   */
  function gapOf(ctx, id) {
    const mine = ctx.me.stocks[id] || 0;
    if (mine <= 0) return 0;

    const groups = ctx.rankHolders(id);
    const gi = myGroupIndex(ctx, id);
    if (gi < 0) return 0;

    if (groups[gi].length > 1) return 0;      // 并列 → 一票之差
    const next = groups[gi + 1];
    if (!next) return 99;
    return mine - next[0].count;
  }

  /** 分红线最后一名的股数（用于判断「差多少能进线」） */
  function lineLastCount(ctx, id) {
    let last = Infinity;
    ctx.players.forEach((p, i) => {
      const count = p.stocks[id] || 0;
      if (count <= 0) return;
      if (dividendFor(ctx, id, i) > 0) last = Math.min(last, count);
    });
    return last === Infinity ? 0 : last;
  }

  /** 再买 extra 张，我能否进分红线 */
  function wouldEnterLine(ctx, id, extra) {
    const size = ctx.sizes[id] || 0;
    const pay = ctx.payouts(size, id);
    if (!pay) return false;

    const counts = ctx.players
      .map((p, i) => ({
        player: i,
        count: (p.stocks[id] || 0) + (i === ctx.meIdx ? extra : 0),
      }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count);

    const groups = [];
    let last = null;
    counts.forEach((h) => {
      if (last === h.count) groups[groups.length - 1].push(h);
      else { groups.push([h]); last = h.count; }
    });

    const dist = ctx.E.computeDividends(ctx.mode, groups, pay);
    return (dist[ctx.meIdx] || 0) > 0;
  }

  /** 并购预警：这家公司旁边有能连到别的公司的空格 */
  function mergeWarning(ctx, id) {
    const g = (ctx.geo || {})[id];
    return !!g && (g.gaps || 0) > 0;
  }

  /** 这一张买下去能不能追上分红线（最多 3 张） */
  function canCatchLine(ctx, id, price) {
    const mine = ctx.me.stocks[id] || 0;
    const need = Math.max(0, lineLastCount(ctx, id) + 1 - mine);
    if (need <= 0) return true;
    if (need > 3) return false;
    return ctx.me.cash >= need * price;
  }

  /**
   * 买股打分。返回值同时带一个 urgent 标记：
   *   urgent = 属于 T1（保位）或 T3（将死）
   *   —— 现金低于 1000 时，只有 urgent 才允许把钱花穿。
   */
  function buyScore(ctx, id, size, price) {
    const my = ctx.me.stocks[id] || 0;
    const inLine = dividendOfMe(ctx, id) > 0;
    const gap = gapOf(ctx, id);
    const gi = myGroupIndex(ctx, id);

    // 最朴素的价值：规模 + 股价
    let score = size * 2 + price * 0.1;
    let urgent = false;

    /*
     * 分散购买（新）：
     *   前期 = 还有公司没出现过。前期不要死磕一家非安全公司，
     *   「获得更高股东」比「保位置」更值钱；非前期两者相当。
     */
    const early = isEarlyGame(ctx);

    // 完全没持有时，略微鼓励开新仓，避免一直只买同一家
    if (my === 0) score += TUNING.newPosition;



    /*
     * 升股东：再买一张就能追平/超过上一组。
     * 非前期与「保位置」相当（1000）；前期要高于保位（保位此时只有 500/400）。
     */
    const above = groupAboveCount(ctx, id);
    if (above > 0 && my + 1 >= above && my > 0) {
      score += TUNING.rankUp;
    }

    /*
     * 壁垒已建立（与后一名差 ≥4 张）→ 别再加仓这家了。
     * 实战记录里 AI 明明已经领先很多还在猛买，钱很快花光。
     */
    /*
     * 注意：只有「我已经是第一名」时，壁垒才算数。
     * 第二名持有很多股但还没追上，属于正要升股东，不能扣分。
     */
    if (gi === 0 && gap >= 4) score += TUNING.safeLeadPenalty;
    if (gi === 0 && gap >= 6) score += TUNING.safeLeadPenaltyFar;        // 差距越大越没必要买

    // 前期反死磕：非安全公司、已持有不少且位置稳固 → 压分
    if (early && gi === 0 && size < 11 && my >= 4 && gap >= 4 && !mergeWarning(ctx, id)) {
      score += TUNING.fixationPenalty;
    }

    /* ---- T1 护食与保命 ---- */
    if (inLine && gap < 4) {
      /*
       * 前期「保位置」要让位于「获得更高股东」，所以权重减半；
       * 非前期两者相当（都按满值）。
       */
      const full = my >= 4 ? TUNING.defendFull : TUNING.defendSmall;
      score += early ? full / 2 : full;

      // 只有真的持有一把（≥4 张）才值得动用兜底现金去保；
      // 1~3 张的位置守不住就算了，别为此把自己搞到破产。
      if (my >= 4) urgent = true;
    }

    /* ---- T2 疯狂追分 ---- */
    if (!inLine && my > 0) {
      const need = Math.max(0, lineLastCount(ctx, id) + 1 - my);
      /*
       * 玩家原话：持有 ≥4 张，或者与线内最后一名差 ≤3 张，都会尝试追。
       * 之前写成「两个条件同时满足」，等于几乎不追。
       */
      const worthChasing = my >= 4 || need <= 3;
      if (worthChasing && !gaveUpChasing(ctx, id)) score += 600;
    }

    /* 搭便车：新秀公司，我一张没有，但三张就能进线 */
    if (my === 0 && size >= 2 && size <= 4 && wouldEnterLine(ctx, id, 3)) {
      score += 400;
    }

    /* ---- T3 末日狂奔 ---- */
    /*
     * T3 只加分，**不授权花穿兜底线**。
     *
     * 「旁边有能连到别人的空格」在棋盘上太常见了，几乎每家都成立；
     * 一旦让它标 urgent，1000 的现金兜底就形同虚设 ——
     * 实战里 AI 会把钱花到只剩 100，然后连续好几回合一张股票都买不了。
     * 真正值得破例的只有 T1（保住分红位置）。
     */
    if (mergeWarning(ctx, id)) {
      if (gi === 0 && gap <= 3) score += 800;
      else if (gi === 1) score += 500;
      else if (inLine) score += 200;
    }

    /*
     * 小公司死磕罚分：规模 ≤3 且我已经拿了 6 张以上，再买就是纯压钱。
     * 实战里出现过「在 2 块的公司上压 10 张，直到终局都没长起来」。
     */
    if (size <= 3 && my >= 6 && !mergeWarning(ctx, id)) {
      score -= 150;
    }

    /*
     * 本回合藏了并购牌：买股必须优先砸进那家被吞并公司，
     * 否则「先买股」这个动作等于没发生。
     */
    if (P(ctx).brain) {
      const brain = brainOf(ctx);
      const saved = brain.mem && brain.mem.savedTile;
      if (saved && saved.loserId === id) {
        score += 900;
        urgent = true;          // 这是明确的「花穿兜底也要买」目标
      }
    }

    /* ---- T4 并购胜方提前卡位 ---- */
    if (mergeWarning(ctx, id) && my <= 1) score += 100;

    return { score, urgent };
  }

  /** 我开始追过、且已经放弃的公司 */
  function gaveUpChasing(ctx, id) {
    const brain = brainOf(ctx);
    return !!(brain.mem && brain.mem.gaveUp && brain.mem.gaveUp[id]);
  }

  function pickBuys(ctx) {
    ctx.geo = ctx.geo || buildGeo(ctx);

    const brain = P(ctx).brain ? observeBrain(ctx) : null;

    /* 开局先把「该放弃的追赶」结掉：
       上一回合追过、这一回合仍然追不上 → 永远放弃这家。 */
    if (brain && brain.mem) {
      brain.mem.gaveUp = brain.mem.gaveUp || {};
      Object.keys(brain.mem.chase || {}).forEach((id) => {
        const size = ctx.sizes[id] || 0;
        const price = ctx.priceOf(size, id) || 0;
        const mine = ctx.me.stocks[id] || 0;
        const stillOut = dividendOfMe(ctx, id) <= 0;
        if (stillOut && !canCatchLine(ctx, id, price)) {
          brain.mem.gaveUp[id] = true;
        }
        if (!stillOut || mine === 0) delete brain.mem.gaveUp[id];
      });
    }

    const avail = [];
    const founded = ctx.E.foundedCompanies(ctx.game);

    for (const id of founded) {
      if ((ctx.shares[id] || 0) <= 0) continue;
      const size = ctx.sizes[id] || 0;
      const price = ctx.priceOf(size, id);
      if (!price) continue;
      const scored = buyScore(ctx, id, size, price);
      avail.push({ id, size, price, score: scored.score, urgent: scored.urgent });
    }

    if (!avail.length) return [];

    const safe = P(ctx).easyBias ? 0 : 1000;    // 现金兜底
    let left = ctx.me.cash;                      // 本地可用现金（不碰真对象）
    const picks = [];

    /*
     * 本回合藏了并购牌时，只买「够提升名次」的张数，不许多买。
     * 多买一张就是白花钱 —— 正是之前 AI 提前破产的原因之一。
     */
    const saved = brain && brain.mem ? brain.mem.savedTile : null;
    const savedId = saved ? saved.loserId : null;
    let savedLeft = saved ? Math.max(1, Math.min(3, saved.need || 1)) : 0;

    while (picks.length < 3) {
      avail.sort((a, b) => b.score - a.score);

      const pickable = avail.find((x) => {
        if (savedId && x.id === savedId && savedLeft <= 0) return false;  // 目标已买够
        if (left < x.price) return false;       // 买不起
        // 低于兜底线时，只允许「保位 / 将死」这类紧急情况花穿
        if (left - x.price < safe && !x.urgent) return false;
        return true;
      });
      if (!pickable) break;

      picks.push(pickable.id);
      if (savedId && pickable.id === savedId) savedLeft -= 1;

      /*
       * 只减本地的 left，**绝不改 ctx.me.cash**。
       * ctx.me 是调用方传进来的真玩家对象，这里改了等于替它付钱，
       * 之后 aiBuy 还会再扣一次 —— 每张股票扣两次，AI 越打越穷。
       */
      left -= pickable.price;

      // 买完局势变了：我的持股、名次、壁垒都跟着变，重新打分
      const rescored = buyScore(ctx, pickable.id, pickable.size, pickable.price);
      pickable.score = rescored.score - 8;
      pickable.urgent = rescored.urgent;
    }

    /* 记下「我在追这家」——下次轮到我时评估要不要放弃 */
    if (brain && brain.mem) {
      brain.mem.chase = brain.mem.chase || {};
      picks.forEach((id) => {
        if (dividendOfMe(ctx, id) > 0) { delete brain.mem.chase[id]; return; }
        const mine = ctx.me.stocks[id] || 0;
        if (mine >= 4) brain.mem.chase[id] = ctx.round || 0;
      });
    }

    return picks;
  }

  /* ------------------------------------------------------------- 导出 */

  const api = {
    pickTile,
    pickSurvivor,
    pickStock,
    pickBuys,
    buildGeo,
    // 供测试用
    resetBrains,
    _internals: { scoreTile, buyScore, isHarmful, pickBest, mergerGain, PROFILE, brainOf, endgameBias, gapOf, myDividend },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AcquireAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
