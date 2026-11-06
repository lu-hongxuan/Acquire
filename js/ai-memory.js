/* ==========================================================================
   并购风云 · AI 记忆

   困难档 AI 的「记牌」能力。它只记**无法从当前状态推导**的东西：
     - 每个人上一次的持股（用来算变化）
     - 本回合谁在买、谁在卖、谁被吞
     - 谁抢走了我的第一大股东（记仇用）
     - 敌意值

   股价、公司规模、股东排行这些都能实时算，不存 —— 存两份只会让记忆和现实打架。

   模块本身**不读全局状态**：调用方（ai.js）把一份快照传进来，这里只做纯计算，
   所以可以脱离浏览器直接跑单元测试。
   ========================================================================== */

(function (root) {
  'use strict';

  var EVENT_LIMIT = 12;      // 最多保留多少条事件
  var GRUDGE_MAX = 10;       // 敌意值上限
  var GRUDGE_DECAY = 1;      // 每回合衰减

  /** 新建一份记忆 */
  function create(meIdx) {
    return {
      meIdx: meIdx,
      round: 0,
      lastStocks: {},        // { playerIdx: { companyId: count } }
      lastTop: {},           // { companyId: playerIdx } 上一次的第一大股东
      delta: {},             // { playerIdx: { companyId: { buy, sell, lost } } }
      events: [],            // [{ round, type, company, by }]
      grudges: {},           // { playerIdx: 0..10 }
      baseline: false,       // 是否已经有过一次基线快照（注意别和 seen 撞名）
      chase: {},             // { companyId: round } 我在追这家，用来判断何时放弃
      gaveUp: {},            // { companyId: true } 追过但追不上，不再追
      seen: {},              // { companyId: true } 这家公司出现过（判断「前期」）
      tileMarks: {},         // { "c,r": { loserId, weight, sharesAt, sizeAt } } 牌的权重记忆
    };
  }

  function stocksOf(players, idx) {
    return (players && players[idx] && players[idx].stocks) || {};
  }

  /**
   * 更新记忆。
   *
   * snap = {
   *   round:  number,
   *   meIdx:  number,
   *   players: [{ stocks }],          // 当前持股
   *   holders: { companyId: [{player, count}] },  // 当前排行（按持股降序）
   *   alive:  { companyId: true },    // 哪家公司还在场上
   * }
   *
   * 返回被更新后的记忆（同一个对象，方便链式调用）。
   */
  function update(mem, snap) {
    if (!mem || !snap) return mem;

    var me = snap.meIdx != null ? snap.meIdx : mem.meIdx;
    mem.meIdx = me;

    var n = (snap.players || []).length;
    var delta = {};
    var allCompanies = {};

    /*
     * 第一次观察只建立基线。
     * 否则「从无到有」会被当成「所有人都在疯狂买入」，
     * 第一回合就凭空出现一堆 buy，敌意判断全错。
     */
    if (!mem.baseline) {
      mem.baseline = true;
      mem.lastStocks = {};
      for (var s0 = 0; s0 < n; s0++) {
        mem.lastStocks[s0] = Object.assign({}, stocksOf(snap.players, s0));
      }
      Object.keys(snap.holders || {}).forEach(function (id) {
        var l = snap.holders[id] || [];
        if (l.length) mem.lastTop[id] = l[0].player;
      });
      mem.round = snap.round != null ? snap.round : mem.round;
      mem.delta = {};
      return mem;
    }

    /* 1. 先按回合衰减旧敌意，再记本回合新增的（顺序反了会互相抵消） */
    if (snap.round != null && snap.round !== mem.round) {
      mem.round = snap.round;
      Object.keys(mem.grudges || {}).forEach(function (k) {
        var v = mem.grudges[k] - GRUDGE_DECAY;
        if (v <= 0) delete mem.grudges[k];
        else mem.grudges[k] = v;
      });
    }

    /* 2. 逐人逐公司算变化，区分「主动买卖」与「被吞并」 */
    for (var p = 0; p < n; p++) {
      var now = stocksOf(snap.players, p);
      var prev = (mem.lastStocks && mem.lastStocks[p]) || {};
      var per = {};

      Object.keys(now).forEach(function (id) { allCompanies[id] = true; });
      Object.keys(prev).forEach(function (id) { allCompanies[id] = true; });

      Object.keys(allCompanies).forEach(function (id) {
        var a = prev[id] || 0;
        var b = now[id] || 0;
        if (a === b) return;

        var stillAlive = snap.alive ? !!snap.alive[id] : true;

        if (b > a) {
          per[id] = { buy: b - a, sell: 0, lost: 0 };
        } else if (!stillAlive) {
          // 公司没了 → 股票是被规则吞掉的，不是他自己卖的
          per[id] = { buy: 0, sell: 0, lost: a - b };
        } else {
          per[id] = { buy: 0, sell: a - b, lost: 0 };
        }
      });

      delta[p] = per;
    }
    mem.delta = delta;

    /* 2. 第一大股东易主：记仇 */
    Object.keys(snap.holders || {}).forEach(function (id) {
      var list = snap.holders[id] || [];
      if (!list.length) return;

      var top = list[0].player;
      var prevTop = mem.lastTop ? mem.lastTop[id] : null;

      if (prevTop != null && prevTop === me && top !== me) {
        pushEvent(mem, { round: snap.round, type: 'lostTop', company: id, by: top });
        addGrudge(mem, top, 2);
      }
      mem.lastTop[id] = top;
    });

    /* 4. 保存本次持股，供下回合比较 */
    mem.lastStocks = {};
    for (var q = 0; q < n; q++) {
      mem.lastStocks[q] = Object.assign({}, stocksOf(snap.players, q));
    }

    return mem;
  }

  function pushEvent(mem, ev) {
    mem.events.push(ev);
    if (mem.events.length > EVENT_LIMIT) {
      mem.events.splice(0, mem.events.length - EVENT_LIMIT);
    }
  }

  function addGrudge(mem, playerIdx, amount) {
    if (playerIdx == null || playerIdx === mem.meIdx) return;
    var v = (mem.grudges[playerIdx] || 0) + amount;
    mem.grudges[playerIdx] = Math.min(GRUDGE_MAX, v);
  }

  /** 某人对我的敌意能贡献多少分（给决策用） */
  function grudgeAgainst(mem, playerIdx) {
    return (mem.grudges && mem.grudges[playerIdx]) || 0;
  }

  /** 最近的某类事件 */
  function recentEvents(mem, type, limit) {
    var out = [];
    for (var i = mem.events.length - 1; i >= 0 && out.length < (limit || 3); i--) {
      if (!type || mem.events[i].type === type) out.push(mem.events[i]);
    }
    return out;
  }

  var api = { create: create, update: update, grudgeAgainst: grudgeAgainst, recentEvents: recentEvents };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AIMemory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
