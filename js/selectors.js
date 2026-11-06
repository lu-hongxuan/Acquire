/* ==========================================================================
   并购风云 · 只读数据层

   这里只做「算」，不做「画」：
   - 不碰 DOM
   - 不修改传入的数据
   - 不依赖全局 state

   参数都是显式的（board / players / priceOf），所以可以在 Node 里直接跑测试。
   界面层要显示「谁持股多少」「我净资产多少」，都从这里取。

   对外暴露 window.Selectors（Node 下也能 require）。
   ========================================================================== */

(function (root) {
  'use strict';

  /**
   * 某公司在棋盘上的块数。
   * @param {object} board 形如 { "3,4": "saxony", ... }
   */
  function companySize(board, companyId) {
    var n = 0;
    for (var k in (board || {})) {
      if (board[k] === companyId) n += 1;
    }
    return n;
  }

  /**
   * 持股人列表，按股数从大到小；股数相同时按座位顺序，保证结果稳定。
   * @returns {Array<{player:number, name:string, count:number}>}
   */
  function holdersOf(players, companyId) {
    var out = [];
    (players || []).forEach(function (p, i) {
      var count = (p && p.stocks && p.stocks[companyId]) || 0;
      if (count > 0) out.push({ player: i, name: p.name, count: count });
    });

    out.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.player - b.player;
    });
    return out;
  }

  /**
   * 把持股人按「股数相同」分组，从大到小。
   * 分红按组占名次，所以这个分组结构是分红计算与显示的公共基础。
   * @returns {Array<Array<{player:number, name:string, count:number}>>}
   */
  function groupHolders(players, companyId) {
    var groups = [];
    var last = null;

    holdersOf(players, companyId).forEach(function (h) {
      if (last !== null && h.count === last) groups[groups.length - 1].push(h);
      else { groups.push([h]); last = h.count; }
    });

    return groups;
  }

  /** 某个玩家持有哪些公司、各多少张（只看数量 > 0 的） */
  function playerHoldings(player) {
    if (!player || !player.stocks) return [];
    var out = [];
    for (var id in player.stocks) {
      if (player.stocks[id] > 0) out.push({ companyId: id, count: player.stocks[id] });
    }
    return out;
  }

  /**
   * 某玩家持股市值。
   * priceOf(size, companyId) 由调用方提供（价位表在界面层）。
   * 规模不足 2 块的公司按规则还不算成立，这里按 0 计。
   */
  function playerStockValue(board, players, idx, priceOf) {
    var p = (players || [])[idx];
    if (!p) return 0;

    return playerHoldings(p).reduce(function (sum, h) {
      var size = companySize(board, h.companyId);
      if (size < 2) return sum;
      return sum + h.count * (priceOf(size, h.companyId) || 0);
    }, 0);
  }

  /** 净资产 = 现金 + 持股市值 */
  function playerNetWorth(board, players, idx, priceOf) {
    var p = (players || [])[idx];
    if (!p) return 0;
    return (p.cash || 0) + playerStockValue(board, players, idx, priceOf);
  }

  /**
   * 净资产排行，从高到低。
   * @returns {Array<{player:number, name:string, net:number, rank:number}>}
   */
  function standings(board, players, priceOf) {
    var list = (players || []).map(function (p, i) {
      return { player: i, name: p.name, net: playerNetWorth(board, players, i, priceOf) };
    });

    list.sort(function (a, b) {
      if (b.net !== a.net) return b.net - a.net;
      return a.player - b.player;
    });

    // 并列同名次
    var rank = 0;
    var prev = null;
    list.forEach(function (row, i) {
      if (prev === null || row.net !== prev) { rank = i + 1; prev = row.net; }
      row.rank = rank;
    });

    return list;
  }

  /**
   * 一家公司的概况：规模、是否成立、是否安全、股东结构、最大股东。
   * @param {function} priceOf  (size, companyId) => 股价
   * @param {number}   safeSize 安全规模（11）
   */
  function companySummary(board, players, companyId, priceOf, safeSize) {
    var size = companySize(board, companyId);
    var groups = groupHolders(players, companyId);
    var holders = holdersOf(players, companyId);

    return {
      id: companyId,
      size: size,
      active: size >= 2,
      safe: size >= (safeSize || 11),
      price: size >= 2 ? (priceOf(size, companyId) || 0) : 0,
      holders: holders,
      groups: groups,
      topHolder: holders.length ? holders[0] : null,
      totalShares: holders.reduce(function (n, h) { return n + h.count; }, 0),
    };
  }

  /**
   * 找出第一块「放不出去」的手牌下标。
   * isLegal(c, r) 由调用方传入（UI 层用 analyzePlacement 包装）。
   * 返回值 -1 表示全部都能放。
   */
  function firstUnplayable(hand, isLegal) {
    for (var i = 0; i < (hand || []).length; i++) {
      var c = hand[i][0];
      var r = hand[i][1];
      if (!isLegal(c, r)) return i;
    }
    return -1;
  }

  /**
   * 创始人奖励（规则书 §六④）：
   * 股票池里还有股票 → 拿 1 张创始人股票；
   * 25 张已全部被持有 → 改为等值现金（按当前规模股价）。
   */
  function founderReward(held, total, price) {
    if (held >= total) return { stock: 0, cash: price || 0 };
    return { stock: 1, cash: 0 };
  }

  var api = {
    companySize: companySize,
    holdersOf: holdersOf,
    groupHolders: groupHolders,
    playerHoldings: playerHoldings,
    playerStockValue: playerStockValue,
    playerNetWorth: playerNetWorth,
    standings: standings,
    companySummary: companySummary,
    founderReward: founderReward,
    firstUnplayable: firstUnplayable,
  };

  root.Selectors = api;

  // Node 下给测试用
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
