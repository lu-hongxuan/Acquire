/* ==========================================================================
   并购风云 · 规则引擎（纯逻辑，不碰 DOM）
   ==========================================================================
   设计原则：
   - 只依赖自身状态，不读 DOM、不读全局变量，方便用 Node 直接跑测试。
   - 所有「玩家要做的选择」都拆成独立函数（选哪家公司、谁存活、2换1怎么换），
     调用方（UI）负责收集选择后再继续。

   棋盘坐标：col 0–11（A–L），row 0–8（1–9）。
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AcquireEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLS = 12;
  const ROWS = 9;
  const SAFE_SIZE = 11;
  const MAX_COMPANIES = 7;
  const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  const COMPANIES = [
    { id: 'saxony',      name: '萨克森' },
    { id: 'tower',       name: '高塔' },
    { id: 'america',     name: '美国' },
    { id: 'festival',    name: '节日' },
    { id: 'worldwide',   name: '全球' },
    { id: 'continental', name: '大陆' },
    { id: 'imperial',    name: '帝国' },
  ];
  const COMPANY_NAME = {};
  COMPANIES.forEach((c) => { COMPANY_NAME[c.id] = c.name; });

  /** 允许界面层覆盖公司名字（设置里可自定义） */
  function setCompanyNames(map) {
    COMPANIES.forEach((c) => {
      const override = map && map[c.id];
      const name = override && override.name && override.name.trim();
      COMPANY_NAME[c.id] = name || c.name;
    });
  }

  function companyLabel(id) {
    return COMPANY_NAME[id] || id;
  }

  /* ---------------------------------------------------------------- 工具 */

  const key = (c, r) => `${c},${r}`;
  const parseKey = (k) => {
    const [c, r] = k.split(',');
    return [Number(c), Number(r)];
  };
  const coordLabel = (c, r) => `${COL_LABELS[c]}${r + 1}`;
  const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

  function neighbors(c, r) {
    return [
      [c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1],
    ].filter(([x, y]) => inBounds(x, y));
  }

  /* ---------------------------------------------------------------- 建局 */

  function createGame(options) {
    const opts = options || {};
    const playerCount = opts.players || 4;

    return {
      mode: opts.mode === 'tycoon' ? 'tycoon' : 'classic',

      // "c,r" -> companyId | null（null = 零散板块）
      board: Object.create(null),

      // 已上市的公司：id -> { founded: true }
      founded: Object.create(null),

      players: Array.from({ length: playerCount }, (_, i) => ({
        index: i,
        name: `玩家 ${i + 1}`,
        cash: 6000,
        stocks: Object.create(null),   // companyId -> 张数
        cards: [],
      })),

      turn: 0,
      round: 1,
      log: [],
    };
  }

  /* ------------------------------------------------------------ 棋盘查询 */

  function companySize(game, companyId) {
    let n = 0;
    for (const k in game.board) {
      if (game.board[k] === companyId) n++;
    }
    return n;
  }

  function foundedCompanies(game) {
    return Object.keys(game.founded);
  }

  function tileAt(game, c, r) {
    const k = key(c, r);
    return k in game.board ? game.board[k] : undefined;
  }

  /**
   * 从 (c,r) 出发做连通搜索。
   * includeEmpty 为真时把空格也算进连通域（用于判断「这块放下去会连成几块」）。
   */
  function flood(game, c, r, accept) {
    const seen = new Set();
    const stack = [[c, r]];
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = key(x, y);
      if (seen.has(k)) continue;
      if (!accept(x, y)) continue;
      seen.add(k);
      for (const [nx, ny] of neighbors(x, y)) {
        if (!seen.has(key(nx, ny))) stack.push([nx, ny]);
      }
    }
    return seen;
  }

  /**
   * 新板块放下后，与它相连的「零散板块」连通块（含新板块自身）。
   * 只穿过空与该格本身以外的零散板块，不穿过公司板块。
   */
  function neutralGroupWith(game, c, r) {
    return flood(game, c, r, (x, y) => {
      if (x === c && y === r) return true;
      const v = tileAt(game, x, y);
      return v === null;   // 只有零散板块
    });
  }

  /* ------------------------------------------------------------ 放置分析 */

  /**
   * 分析在 (c,r) 放一块板块会发生什么。**不修改状态。**
   * 返回：
   *   { valid: false, reason }
   *   { valid: true, type: 'isolated' }
   *   { valid: true, type: 'found', groupSize, canFound }
   *   { valid: true, type: 'expand', companyId }
   *   { valid: true, type: 'merger', companies: [...], sizes: {...}, tie: bool }
   */
  function analyzePlacement(game, c, r) {
    if (!inBounds(c, r)) return { valid: false, reason: '坐标越界' };
    if (key(c, r) in game.board) return { valid: false, reason: '这一格已经有板块了' };

    // 相邻的公司
    const adj = new Set();
    for (const [x, y] of neighbors(c, r)) {
      const v = tileAt(game, x, y);
      if (v) adj.add(v);
    }
    const companies = [...adj];

    if (companies.length >= 2) {
      const sizes = {};
      for (const id of companies) sizes[id] = companySize(game, id);

      const maxSize = Math.max(...companies.map((id) => sizes[id]));
      const largest = companies.filter((id) => sizes[id] === maxSize);

      /*
       * 安全公司只能当「吞并方」，不能被吞并。
       * 所以不能一刀切地把「参与者里有安全公司」判成非法，
       * 要看它最终是存活的一方，还是被吃掉的一方。
       */
      if (maxSize >= SAFE_SIZE) {
        if (largest.length > 1) {
          // 并列最大的都是安全公司：无论谁存活，另一家都会被吞并
          return {
            valid: false,
            reason: `${largest.map(companyLabel).join('、')} 都已达到安全规模，不能互相吞并`,
          };
        }

        // 存活方已确定是这家最大的公司；再看被吞并的一方有没有安全公司
        const survivorId = largest[0];
        const safeLosers = companies.filter(
          (id) => id !== survivorId && sizes[id] >= SAFE_SIZE
        );
        if (safeLosers.length) {
          const id = safeLosers[0];
          return {
            valid: false,
            reason: `${companyLabel(id)} 已有 ${sizes[id]} 块，处于安全状态，不能被吞并`,
          };
        }
      }

      return {
        valid: true,
        type: 'merger',
        companies,
        sizes,
        // 最大的一家；平局时需要玩家指定谁存活
        largest,
        tie: largest.length > 1,
        // 三家以上连通时也要玩家决定结算顺序
        multiple: companies.length > 2,
        // 与触发板块相连的零散板块，最终都归入存活公司
        absorb: [...neutralGroupWith(game, c, r)].filter((k) => k !== key(c, r)),
      };
    }

    if (companies.length === 1) {
      const id = companies[0];
      const size = companySize(game, id);
      if (size >= 41) {
        // 理论上 41 块直接终局，不该走到这里
        return { valid: false, reason: '公司已达终局规模' };
      }

      // 与这块新板块相连的零散板块，会一起被并进这家公司
      const group = neutralGroupWith(game, c, r);
      const absorb = [...group].filter((k) => k !== key(c, r));

      return {
        valid: true,
        type: 'expand',
        companyId: id,
        size,
        absorb,
        sizeGain: 1 + absorb.length,
      };
    }

    // 没有相邻公司
    const group = neutralGroupWith(game, c, r);
    const foundedCount = foundedCompanies(game).length;

    if (group.size >= 2) {
      return {
        valid: true,
        type: 'found',
        groupSize: group.size,
        group: [...group],
        canFound: foundedCount < MAX_COMPANIES,
        // 7 家都上市后依然可以放置，只是不产生公司层面的效果
        reason: foundedCount >= MAX_COMPANIES ? '7 家公司都已上市，这块只会把零散板块连起来' : '',
      };
    }

    return { valid: true, type: 'isolated' };
  }

  /** 某个玩家这一回合哪些格子可以放 */
  function legalCells(game) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (key(c, r) in game.board) continue;
        const a = analyzePlacement(game, c, r);
        out.push({ c, r, legal: a.valid, analysis: a });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ 执行放置 */

  /**
   * 放下板块。返回事件对象，调用方据此决定后续交互。
   * 注意：创立公司 / 并购结算都需要玩家再选择，这里只落子。
   */
  function applyPlacement(game, c, r) {
    const analysis = analyzePlacement(game, c, r);
    if (!analysis.valid) return { ok: false, reason: analysis.reason, analysis };

    const k = key(c, r);
    game.board[k] = null;   // 先作为零散板块落下

    if (analysis.type === 'expand') {
      game.board[k] = analysis.companyId;

      // 与它相连的零散板块一起并入这家公司
      (analysis.absorb || []).forEach((kk) => { game.board[kk] = analysis.companyId; });
    }

    return {
      ok: true,
      type: analysis.type,
      coord: coordLabel(c, r),
      c,
      r,
      analysis,
    };
  }

  /**
   * 创立公司：把 (c,r) 所在的那片零散板块整体划给 companyId。
   * 返回 { ok, tiles, companyId, founderStock }。
   */
  function foundCompany(game, companyId, c, r) {
    if (game.founded[companyId]) return { ok: false, reason: '这家公司已经上市了' };
    if (foundedCompanies(game).length >= MAX_COMPANIES) {
      return { ok: false, reason: '7 家公司都已上市' };
    }

    const group = neutralGroupWith(game, c, r);
    if (group.size < 2) return { ok: false, reason: '连不成至少 2 块的板块组' };

    group.forEach((k) => { game.board[k] = companyId; });
    game.founded[companyId] = true;

    return {
      ok: true,
      companyId,
      tiles: [...group],
      size: group.size,
      /*
       * 规则默认给 1 张创始人股票。
       * 但股票池是否售罄是「数据层」的判断，不归引擎管：
       * 真正的发放由 Selectors.founderReward() 决定（售罄则改为现金）。
       */
      founderStock: 1,
    };
  }

  /* ------------------------------------------------------------ 并购结算 */

  /**
   * 结算一次并购。
   * survivorId 由调用方（玩家）指定，平局时必须指定。
   * losers 里每家的板块并入存活公司， losers 从 founded 中移除。
   */
  function resolveMerger(game, compact, survivorId, loserId) {
    if (!game.founded[survivorId]) return { ok: false, reason: '存活公司未上市' };
    if (!game.founded[loserId]) return { ok: false, reason: '被吞并公司未上市' };
    if (survivorId === loserId) return { ok: false, reason: '存活方和被吞并方相同' };

    if (companySize(game, loserId) >= SAFE_SIZE) {
      return { ok: false, reason: `${companyLabel(loserId)} 处于安全状态，不能被吞并` };
    }

    let moved = 0;
    for (const k in game.board) {
      if (game.board[k] === loserId) {
        game.board[k] = survivorId;
        moved++;
      }
    }

    delete game.founded[loserId];

    return {
      ok: true,
      survivorId,
      loserId,
      movedTiles: moved,
      survivorSizeAfter: companySize(game, survivorId),
    };
  }

  /**
   * 统计某公司的股东排名。
   * 返回按持股数降序、且已按「并列」分好组的数组：[[{player,count},...], ...]
   */
  function rankHolders(game, companyId) {
    const holders = game.players
      .map((p) => ({ player: p.index, count: p.stocks[companyId] || 0 }))
      .filter((h) => h.count > 0)
      .sort((a, b) => b.count - a.count);

    const groups = [];
    let last = null;
    for (const h of holders) {
      if (last === h.count) groups[groups.length - 1].push(h);
      else {
        groups.push([h]);
        last = h.count;
      }
    }
    return groups;
  }

  /**
   * 按名次和并列规则算分红 —— 规则只有一条：
   *
   *   并列者从应占的首个名次开始，连续占用与并列人数相同数量的名次；
   *   这些名次对应的奖励合并后由并列者平分；后续玩家名次整体顺延。
   *
   * 返回 { byPlayer: {玩家下标: 金额}, rows: [占位信息] }
   * rows 让界面能画出和实际发放完全一致的表格。
   */
  function spreadDividends(mode, groups, payouts) {
    const byPlayer = Object.create(null);
    const rows = [];
    const p = [payouts.first || 0, payouts.second || 0, payouts.third || 0];
    const slots = mode === 'tycoon' ? 3 : 2;

    const add = (idx, v) => { byPlayer[idx] = (byPlayer[idx] || 0) + v; };

    if (!groups.length) return { byPlayer, rows };

    // 独角戏：全场只有一个股东 → 拿「大股东 + 最小股东」两档（实体卡规则）
    if (groups.length === 1 && groups[0].length === 1) {
      const h = groups[0][0];
      const lastPos = mode === 'tycoon' ? 2 : 1;
      const amount = p[0] + (p[lastPos] || 0);
      add(h.player, amount);
      rows.push({
        from: 0,
        to: 0,
        spanFrom: 0,
        spanTo: lastPos,
        amount,
        each: amount,
        players: [h.player],
        solo: true,
      });
      return { byPlayer, rows };
    }

    let pos = 0;
    for (const g of groups) {
      if (pos >= slots) break;

      // 这一组连续占用 g.length 个名次（可能超出 slots，超出的档位金额按 0 计）
      let amount = 0;
      for (let k = 0; k < g.length; k++) amount += (p[pos + k] || 0);

      const each = Math.floor(amount / g.length);
      if (each > 0) g.forEach((h) => add(h.player, each));

      rows.push({
        from: pos,
        to: pos + g.length - 1,
        amount,
        each,
        players: g.map((h) => h.player),
      });

      pos += g.length;
    }

    return { byPlayer, rows };
  }

  /** 兼容旧接口：只要每人的金额 */
  function computeDividends(mode, groups, payouts) {
    return spreadDividends(mode, groups, payouts).byPlayer;
  }

  /* -------------------------------------------------------------- 股票 */

  function stockPrice(game, companyId, size) {
    return { companyId, size };   // 价格表在 UI 层，引擎只负责数量关系
  }

  function buyStock(game, playerIndex, companyId, count, unitPrice) {
    const p = game.players[playerIndex];
    const cost = unitPrice * count;
    if (p.cash < cost) return { ok: false, reason: '现金不足' };

    p.cash -= cost;
    p.stocks[companyId] = (p.stocks[companyId] || 0) + count;
    return { ok: true, cost };
  }

  function sellStock(game, playerIndex, companyId, count, unitPrice) {
    const p = game.players[playerIndex];
    const have = p.stocks[companyId] || 0;
    if (have < count) return { ok: false, reason: '持股不足' };

    p.stocks[companyId] = have - count;
    p.cash += unitPrice * count;
    return { ok: true, gain: unitPrice * count };
  }

  /* ------------------------------------------------------------ 终局判定 */

  function checkEnd(game) {
    const ids = foundedCompanies(game);
    if (!ids.length) return { over: false };

    let anyFortyOne = null;
    let allSafe = true;

    for (const id of ids) {
      const size = companySize(game, id);
      if (size >= 41 && !anyFortyOne) anyFortyOne = id;
      if (size < SAFE_SIZE) allSafe = false;
    }

    if (anyFortyOne) return { over: true, reason: 'size41', companyId: anyFortyOne };
    if (allSafe) return { over: true, reason: 'allSafe' };
    return { over: false };
  }

  /* -------------------------------------------------------------- 导出 */

  return {
    COLS, ROWS, SAFE_SIZE, MAX_COMPANIES, COL_LABELS, COMPANIES, COMPANY_NAME,
    setCompanyNames, companyLabel,

    key, parseKey, coordLabel, inBounds, neighbors,

    createGame,
    companySize, foundedCompanies, tileAt,
    neutralGroupWith, flood,

    analyzePlacement,
    legalCells,
    applyPlacement,
    foundCompany,
    resolveMerger,

    rankHolders,
    computeDividends,
    spreadDividends,

    buyStock, sellStock,
    checkEnd,
  };
});