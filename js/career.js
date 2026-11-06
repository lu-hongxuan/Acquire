/**
 * 《并购风云》生涯档案与成就系统
 * 数据存在 localStorage，单键 `acquire.career.v1`。
 *
 * 设计依据：_整改方案/生涯与成就系统设计案.md 第三节（四大象限）
 * 30 个成就，分四类：财富 / 运营 / 博弈 / 挑战。
 *
 * 数据分两层：
 *   d —— 生涯档案（跨局累计，存 localStorage）
 *   m —— 本局统计（开局清零，结算后合并进 d）
 *
 * finishMatch() 负责：
 *   1. 把 m 的一次性数据合并进 d（峰值、累计、连胜）
 *   2. 逐条算每个成就当前该是几阶
 *   3. 与已解锁档位比较，返回「本局新解锁」
 */

(function (root) {
  'use strict';

  const KEY = 'acquire.career.v1';

  /* ------------------------------------------------------------ 成就定义 */

  const A = (id, cat, name, desc, tiers, lower) => ({
    id, cat, name, desc, tiers, lower,
  });

  const ACHIEVEMENTS = [
    /* ---------------- 财富与分红 ---------------- */
    A('firstGold', 'wealth', '第一桶金', '完成你的第一场游戏', [
      { v: 1, unit: ' 场' }, { v: 10, unit: ' 场' }, { v: 50, unit: ' 场' },
    ]),
    A('tycoon', 'wealth', '华尔街大亨', '终局净资产突破指定金额', [
      { v: 40000 }, { v: 60000 }, { v: 80000 },
    ]),
    A('harvest', 'wealth', '精准收割', '一次并购里同时拿下大股东与二股东分红（唯一持股人）', [
      { v: 1, unit: ' 次/局' }, { v: 2, unit: ' 次/局' }, { v: 3, unit: ' 次/局' },
    ]),
    A('oligarch', 'wealth', '寡头垄断', '4 人以上对局夺冠，并在现金上形成绝对统治', [
      { v: '领先 20%' }, { v: '领先 40%' }, { v: '一人单挑全场' },
    ]),
    A('cumDividend', 'wealth', '财源滚滚', '生涯累计获得的分红总额', [
      { v: 100000 }, { v: 500000 }, { v: 1000000 },
    ]),
    A('photo', 'wealth', '毫厘之差', '夺冠时与第二名的差距', [
      { v: 1000 }, { v: 500 }, { v: 100 },
    ], true),
    A('upstart', 'wealth', '暴发户', '单次并购中套现股票获得的总收益（不含分红）', [
      { v: 10000 }, { v: 13000 }, { v: 20000 },
    ]),

    /* ---------------- 运营与布局 ---------------- */
    A('founder', 'build', '白手起家', '单局创立连锁酒店', [
      { v: 2, unit: ' 家/局' }, { v: 4, unit: ' 家/局' }, { v: 6, unit: ' 家/局' },
    ]),
    A('mergerKing', 'build', '并购狂魔', '单局亲手触发并购', [
      { v: 3, unit: ' 次/局' }, { v: 5, unit: ' 次/局' }, { v: 8, unit: ' 次/局' },
    ]),
    A('rushSurvive', 'build', '乱世求生', '没有任何公司达到安全规模，靠 41 块结束游戏', [
      { v: 3, unit: ' 次' }, { v: 5, unit: ' 次' }, { v: 10, unit: ' 次' },
    ]),
    A('peaceLove', 'build', '爱的国度', '整局没有发生任何并购', [
      { v: 1, unit: ' 次' }, { v: 3, unit: ' 次' }, { v: 5, unit: ' 次' },
    ]),
    A('chain', 'build', '连锁帝国', '终局持有单一公司股票的峰值', [
      { v: 15, unit: ' 张' }, { v: 20, unit: ' 张' }, { v: 25, unit: ' 张' },
    ]),
    A('multiMerge', 'build', '多管齐下', '一块板块同时引发的公司数量', [
      { v: 2, unit: ' 家' }, { v: 3, unit: ' 家' }, { v: 4, unit: ' 家' },
    ]),
    A('shareHoard', 'build', '财迷心窍', '单局累计买入股票张数', [
      { v: 30, unit: ' 张' }, { v: 40, unit: ' 张' }, { v: 50, unit: ' 张' },
    ]),
    A('wolfStreet', 'build', '华尔街之狼', '连续夺冠', [
      { v: 2, unit: ' 场' }, { v: 3, unit: ' 场' }, { v: 10, unit: ' 场' },
    ]),
    A('underdog', 'build', '贝肯街之犬', '连续垫底', [
      { v: 2, unit: ' 场' }, { v: 5, unit: ' 场' }, { v: 6, unit: ' 场' },
    ]),

    /* ---------------- 博弈与心理战 ---------------- */
    A('edge', 'mind', '极限卡位', '仅以 1 张优势抢走对手的大股东位置', [
      { v: 1, unit: ' 次/局' }, { v: 2, unit: ' 次/局' }, { v: 3, unit: ' 次/局' },
    ]),
    A('sleight', 'mind', '空手套白狼', '用 2换1 把自己换成存活公司的大股东', [
      { v: 1, unit: ' 次/局' }, { v: 2, unit: ' 次/局' }, { v: 3, unit: ' 次/局' },
    ]),

    /* ---------------- 挑战与趣味 ---------------- */
    A('dragon', 'challenge', '屠龙勇士', '在困难 AI 局中获胜', [
      { v: 10, unit: ' 胜' }, { v: 20, unit: ' 胜' }, { v: 50, unit: ' 胜' },
    ]),
    A('blitz', 'challenge', '闪电战', '快速结束游戏并夺冠', [
      { v: 30, unit: ' 回合内' }, { v: 25, unit: ' 回合内' }, { v: 20, unit: ' 回合内' },
    ], true),
    A('allIn', 'challenge', '梭哈', '整局只买过一家公司的股票，并夺冠', [
      { v: 1, unit: ' 次' }, { v: 3, unit: ' 次' }, { v: 5, unit: ' 次' },
    ]),
    A('workerKing', 'challenge', '打工皇帝', '终局手中 0 张股票，却拿到第一名', [
      { v: 1, unit: ' 次' }, { v: 10, unit: ' 次' }, { v: 23, unit: ' 次' },
    ]),
    A('brokeBuyer', 'challenge', '剁手党', '穷到买不起任何一张股票的回合', [
      { v: '5 回合' }, { v: '10 回合' }, { v: '超三分之二' },
    ]),
    A('zenKeeper', 'challenge', '佛系玩家', '生涯累计保留（不卖不换）的股票张数', [
      { v: 30, unit: ' 张' }, { v: 66, unit: ' 张' }, { v: 100, unit: ' 张' },
    ]),
    A('wheelKing', 'challenge', '车轮大王', '生涯累计置换组数（2 张换 1 张算 1 组）', [
      { v: 66, unit: ' 组' }, { v: 88, unit: ' 组' }, { v: 233, unit: ' 组' },
    ]),
    A('sevenHold', 'challenge', '资本大鳄', '单局同时持有场上全部 7 家公司的股票', [
      { v: 5, unit: ' 局' }, { v: 15, unit: ' 局' }, { v: 50, unit: ' 局' },
    ]),
    A('poorSoul', 'challenge', '大冤种', '自己发动并购，分红却是全场最低（通常是 0）', [
      { v: 10, unit: ' 次' }, { v: 20, unit: ' 次' }, { v: 50, unit: ' 次' },
    ]),
    A('miser', 'challenge', '铁公鸡', '现金始终没低于 $6,000，并夺冠', [
      { v: 2, unit: ' 次' }, { v: 5, unit: ' 次' }, { v: 10, unit: ' 次' },
    ]),
    A('timeoutHero', 'challenge', '你们怎么不动啊？', '触发超时代打（系统替你完成了操作）', [
      { v: 1, unit: ' 次' }, { v: 2, unit: ' 次' }, { v: 3, unit: ' 次' },
    ]),
    A('knowThis', 'challenge', '你知道这个', '你也许不知道这个，但你现在知道了，你知道了吗？', [
      { v: 1, unit: ' 次' }, { v: 2, unit: ' 次' }, { v: 3, unit: ' 次' },
    ]),
  ];

  /* ------------------------------------------------------------ 档案 */

  function fresh() {
    return {
      ver: 2,
      games: 0,
      wins: 0,
      rankSum: 0,
      cumNet: 0,
      bestNet: 0,
      cumDividend: 0,
      bestDividend: 0,
      cumMergers: 0,
      founderTotal: 0,
      sellCount: 0,
      swapCount: 0,
      keepCount: 0,
      favCompany: {},
      recent: [],
      unlocked: {},
      hardWins: 0,

      /* 峰值 / 累计 */
      dominancePeak: 0,        // 0/1/2/3：寡头垄断
      photoBest: 0,            // 夺冠时与第二名的差距（取最小；0 = 还没夺冠）
      cashoutPeak: 0,          // 单次并购套现收益峰值
      rushCount: 0,
      peaceCount: 0,
      winStreak: 0,
      loseStreak: 0,
      winStreakBest: 0,
      loseStreakBest: 0,
      buySharesMax: 0,
      multiMergeMax: 0,
      allInWins: 0,
      workerWins: 0,
      brokeBest: 0,            // 0/1/2/3
      sevenHoldCount: 0,
      poorSoulCount: 0,
      stingyWins: 0,
      autoPlayCount: 0,
      knowThisCount: 0,

      /* 单局最高值：成就提示里显示「当前最高 N/局」用 */
      foundersMax: 0,
      soloDividendMax: 0,
      maxSingleStockPeak: 0,
      edgeMax: 0,
      sleightMax: 0,
      triggerMax: 0,
      fastestWinRound: 0,

      lastMatch: null,

      /* 对局记录：每局一份快照序列，只保留最近 10 局 */
      replays: [],
    };
  }

  let data = null;
  let match = null;

  function load() {
    if (data) return data;
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      data = raw ? Object.assign(fresh(), JSON.parse(raw)) : fresh();
    } catch (e) {
      data = fresh();
    }
    return data;
  }

  function save() {
    try {
      if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(load()));
    } catch (e) { /* 存不进去也不影响本局 */ }
  }

  /* ------------------------------------------------------------ 本局统计 */

  function startMatch() {
    match = {
      startedAt: Date.now(),
      dividends: 0,
      soloDividends: 0,
      founders: 0,
      triggers: 0,
      maxCompanies: 0,
      buys: 0,
      buyShares: 0,
      buyCompanies: {},
      maxSingleStock: 0,
      sell: 0,
      swap: 0,
      keep: 0,
      maxCashout: 0,
      edge: 0,
      sleight: 0,
      brokeTurns: 0,
      worstDividend: 0,
      autoPlays: 0,

      /* 复盘用的快照序列，结算时才写进档案 */
      frames: [],
    };
    return match;
  }

  /** 记账：调用方只说明「发生了什么」，怎么累计在这里 */
  function note(event, payload) {
    const p = payload || {};
    if (!match) startMatch();
    const d = load();

    switch (event) {
      case 'dividend':
        match.dividends += p.amount || 0;
        if (p.solo) match.soloDividends += 1;
        d.cumDividend += p.amount || 0;
        if ((p.amount || 0) > d.bestDividend) d.bestDividend = p.amount || 0;
        break;

      case 'found':
        match.founders += 1;
        break;

      case 'trigger':
        match.triggers += 1;
        if (p.count) match.maxCompanies = Math.max(match.maxCompanies, p.count);
        break;

      case 'buy': {
        const id = p.companyId;
        const shares = p.shares || 1;
        match.buys += 1;
        match.buyShares += shares;
        if (id) {
          match.buyCompanies[id] = (match.buyCompanies[id] || 0) + 1;
          d.favCompany[id] = (d.favCompany[id] || 0) + 1;
          const held = p.held || 0;
          if (held > match.maxSingleStock) match.maxSingleStock = held;
        }
        break;
      }

      case 'stockDispose':
        match.sell += p.sell || 0;
        match.swap += p.swap || 0;
        match.keep += p.keep || 0;
        if (p.cashout) match.maxCashout = Math.max(match.maxCashout, p.cashout);
        break;

      case 'edge':
        match.edge += 1;
        break;

      case 'sleight':
        match.sleight += 1;
        break;

      case 'broke':
        match.brokeTurns += 1;
        break;

      case 'worstDividend':
        match.worstDividend += 1;
        break;

      case 'autoPlay':
        match.autoPlays += 1;
        break;

      default:
        break;
    }
  }

  /**
   * 记录一帧（一回合结束时的完整快照）。
   *
   * 用快照而不是「操作日志 + 重放」，因为引擎是纯函数：
   * 把某一帧的棋盘和持股直接喂给渲染层就能画出来，
   * 不需要重跑整局，也就不会因为规则微调而回放错乱。
   *
   * 每帧只存必要字段，一局 50 回合大约 60~120KB。
   */
  function recordFrame(frame) {
    if (!match) return;
    const frames = match.frames;
    if (!frames) return;
    if (frames.length >= 200) return;      // 硬上限，防止异常长局撑爆存储

    frames.push({
      round: frame.round,
      turn: frame.turn,
      board: frame.board,
      players: frame.players,
      shares: frame.shares,
      events: frame.events || [],
    });
  }

  /* ------------------------------------------------------------ 结算 */

  /** 够到第几阶（lower = 越小越好；非数字档位不参与比较） */
  function evalTier(def, value, lower) {
    let tier = 0;
    def.tiers.forEach((t, i) => {
      if (typeof t.v !== 'number') return;
      const ok = lower ? value > 0 && value <= t.v : value >= t.v;
      if (ok) tier = i + 1;
    });
    return tier;
  }

  /**
   * 彩蛋「你知道这个」：每次终局掷一次。
   *   01:00–05:00：1–100，命中 2 / 5 / 6 / 26 / 52
   *   其余时间：   1–1000，命中 526
   */
  function rollKnowThis(now) {
    const hour = new Date(now).getHours();
    if (hour >= 1 && hour < 5) {
      const n = 1 + Math.floor(Math.random() * 100);
      return [2, 5, 6, 26, 52].indexOf(n) >= 0;
    }
    const n = 1 + Math.floor(Math.random() * 1000);
    return n === 526;
  }

  /**
   * 结算本局。
   * summary 里除名次与现金外，还要带上几个「本局事实」：
   *   minCash        本局现金最低值
   *   zeroStock      终局手中 0 张股票
   *   rushEnding     没有公司达到安全规模、靠 41 块结束
   *   sevenHold      终局同时持有 7 家
   *   sumOthersCash  其他人现金之和（寡头垄断第三档用）
   */
  function finishMatch(summary) {
    const d = load();
    const m = match || startMatch();
    const now = Date.now();

    d.games += 1;
    d.rankSum += summary.rank;

    const isWin = summary.rank === 1;
    if (isWin) d.wins += 1;
    d.cumNet += summary.net;
    d.bestNet = Math.max(d.bestNet, summary.net);
    d.founderTotal += m.founders;
    d.cumMergers += m.triggers;
    d.sellCount += m.sell;
    d.swapCount += m.swap;
    d.keepCount += m.keep;
    d.recent = (d.recent || []).concat([summary.rank]).slice(-20);

    /* 连胜 / 连败 */
    d.winStreak = isWin ? (d.winStreak || 0) + 1 : 0;
    d.loseStreak = (summary.rank === summary.players) ? (d.loseStreak || 0) + 1 : 0;
    d.winStreakBest = Math.max(d.winStreakBest || 0, d.winStreak);
    d.loseStreakBest = Math.max(d.loseStreakBest || 0, d.loseStreak);

    if (summary.difficulty === 'hard' && isWin) d.hardWins += 1;

    /* 寡头垄断：仅 4 人以上，且夺冠 */
    if (isWin && summary.players >= 4) {
      const second = summary.secondCash || 0;
      const mine = summary.myCash || 0;
      let score = 0;
      if (summary.sumOthersCash && mine > summary.sumOthersCash) score = 3;
      else if (second > 0 && mine >= second * 1.4) score = 2;
      else if (second > 0 && mine >= second * 1.2) score = 1;
      d.dominancePeak = Math.max(d.dominancePeak || 0, score);
    }

    /* 毫厘之差：夺冠时最小的差距 */
    if (isWin) {
      const margin = (summary.secondCash != null) ? (summary.myCash - summary.secondCash) : Infinity;
      if (margin > 0) {
        d.photoBest = d.photoBest ? Math.min(d.photoBest, margin) : margin;
      }
    }

    /* 峰值类 */
    /* 单局最高值 */
    d.foundersMax = Math.max(d.foundersMax || 0, m.founders);
    d.soloDividendMax = Math.max(d.soloDividendMax || 0, m.soloDividends);
    d.maxSingleStockPeak = Math.max(d.maxSingleStockPeak || 0, m.maxSingleStock);
    d.edgeMax = Math.max(d.edgeMax || 0, m.edge);
    d.sleightMax = Math.max(d.sleightMax || 0, m.sleight);
    d.triggerMax = Math.max(d.triggerMax || 0, m.triggers);

    if (isWin && summary.rounds) {
      d.fastestWinRound = d.fastestWinRound
        ? Math.min(d.fastestWinRound, summary.rounds)
        : summary.rounds;
    }

    d.cashoutPeak = Math.max(d.cashoutPeak || 0, m.maxCashout);
    d.buySharesMax = Math.max(d.buySharesMax || 0, m.buyShares);
    d.multiMergeMax = Math.max(d.multiMergeMax || 0, m.maxCompanies);
    d.poorSoulCount += m.worstDividend;
    d.autoPlayCount += m.autoPlays;

    /* 计数类 */
    if (summary.rushEnding) d.rushCount += 1;
    if (m.triggers === 0) d.peaceCount += 1;
    if (summary.sevenHold) d.sevenHoldCount += 1;
    if (isWin && summary.zeroStock) d.workerWins += 1;
    if (isWin && Object.keys(m.buyCompanies || {}).length === 1) d.allInWins += 1;
    if (isWin && (summary.minCash || 0) >= 6000) d.stingyWins += 1;

    /* 剁手党：本局买不起股票的回合数 / 占比 */
    {
      const rounds = summary.rounds || 0;
      const broke = m.brokeTurns;
      let score = 0;
      if (rounds > 30 && broke * 3 > rounds * 2) score = 3;
      else if (broke >= 10) score = 2;
      else if (broke >= 5) score = 1;
      d.brokeBest = Math.max(d.brokeBest || 0, score);
    }

    /* 彩蛋 */
    if (rollKnowThis(now)) d.knowThisCount += 1;

    /* 逐条评阶 */
    const values = {
      firstGold: d.games,
      tycoon: d.bestNet,
      harvest: m.soloDividends,
      oligarch: d.dominancePeak,
      cumDividend: d.cumDividend,
      photo: d.photoBest,
      upstart: d.cashoutPeak,

      founder: m.founders,
      mergerKing: m.triggers,
      rushSurvive: d.rushCount,
      peaceLove: d.peaceCount,
      chain: m.maxSingleStock,
      multiMerge: d.multiMergeMax,
      shareHoard: d.buySharesMax,
      wolfStreet: d.winStreakBest,
      underdog: d.loseStreakBest,

      edge: m.edge,
      sleight: m.sleight,

      dragon: d.hardWins,
      blitz: isWin ? (summary.rounds || 0) : 0,
      allIn: d.allInWins,
      workerKing: d.workerWins,
      brokeBuyer: d.brokeBest,
      zenKeeper: d.keepCount,
      wheelKing: d.swapCount,
      sevenHold: d.sevenHoldCount,
      poorSoul: d.poorSoulCount,
      miser: d.stingyWins,
      timeoutHero: d.autoPlayCount,
      knowThis: d.knowThisCount,
    };

    const newly = [];
    ACHIEVEMENTS.forEach((def) => {
      const value = values[def.id];
      if (value == null) return;

      /* 纯文案档位（寡头垄断 / 剁手党）用 0–3 的分档值 */
      const textTiers = def.tiers.some((t) => typeof t.v !== 'number');
      const tier = textTiers
        ? Math.max(0, Math.min(3, value))
        : evalTier(def, value, def.lower);

      const cur = d.unlocked[def.id] || 0;
      if (tier > cur) {
        d.unlocked[def.id] = tier;
        newly.push({
          id: def.id,
          name: def.name,
          tier: ['Ⅰ', 'Ⅱ', 'Ⅲ'][tier - 1],
          value,
        });
      }
    });

    /*
     * 存档一局复盘数据。
     * 只保留最近 10 局 —— 每局几十到上百 KB，超过这个数量 localStorage 会吃紧。
     */
    if (m.frames && m.frames.length) {
      d.replays = d.replays || [];
      d.replays.unshift({
        id: 'm' + now,
        at: now,
        version: 'v1.8.0',
        mode: summary.mode || 'classic',
        names: summary.names || [],
        colors: summary.colors || [],
        humans: summary.humans || [],
        ranks: summary.ranks || [],
        final: summary.final || [],
        rounds: summary.rounds || 0,
        frames: m.frames,
      });
      d.replays = d.replays.slice(0, 10);
    }

    d.lastMatch = {
      rank: summary.rank,
      net: summary.net,
      rounds: summary.rounds,
      at: now,
      newly: newly.length,
    };

    save();
    match = null;

    return {
      newly: newly,
      bestNet: d.bestNet,
      games: d.games,
      wins: d.wins,
    };
  }

  /* ------------------------------------------------------------ 面板数据 */

  function summaryForPanel() {
    const d = load();
    const fav = Object.keys(d.favCompany || {})
      .sort((a, b) => d.favCompany[b] - d.favCompany[a])[0] || '';
    const totalDispose = (d.sellCount || 0) + (d.swapCount || 0) + (d.keepCount || 0);

    return {
      games: d.games,
      wins: d.wins,
      winRate: d.games ? Math.round((d.wins / d.games) * 100) : 0,
      avgRank: d.games ? (d.rankSum / d.games).toFixed(1) : '—',
      cumNet: d.cumNet,
      bestNet: d.bestNet,
      bestDividend: d.bestDividend,
      cumDividend: d.cumDividend,
      cumMergers: d.cumMergers,
      founderTotal: d.founderTotal,
      favCompany: fav,
      sellRate: totalDispose ? Math.round((d.sellCount / totalDispose) * 100) : 0,
      swapRate: totalDispose ? Math.round((d.swapCount / totalDispose) * 100) : 0,
      keepRate: totalDispose ? Math.round((d.keepCount / totalDispose) * 100) : 0,
      recent: (d.recent || []).slice(-20),
      unlocked: d.unlocked || {},
      hardWins: d.hardWins,
    };
  }

  function resetAll() {
    data = fresh();
    save();
    match = null;
  }

  /*
   * 成就提示框里的「当前进度」。
   *
   * kind 决定措辞：
   *   sum   —— 生涯累计：「当前进度 17 次」
   *   game  —— 单局最好成绩：「当前最高 6 次/局」
   *   best  —— 越小越好：「当前最快 22 回合」
   *   score —— 分档评分：「当前最高 Ⅱ 档」
   */
  const PROGRESS = {
    firstGold:   ['sum', (d) => d.games, ' 场'],
    tycoon:      ['sum', (d) => d.bestNet, ''],
    harvest:     ['game', (d) => d.soloDividendMax, ' 次/局'],
    oligarch:    ['score', (d) => d.dominancePeak, ''],
    cumDividend: ['sum', (d) => d.cumDividend, ''],
    photo:       ['best', (d) => d.photoBest, ''],
    upstart:     ['sum', (d) => d.cashoutPeak, ''],

    founder:     ['game', (d) => d.foundersMax, ' 家/局'],
    mergerKing:  ['game', (d) => d.triggerMax, ' 次/局'],
    rushSurvive: ['sum', (d) => d.rushCount, ' 次'],
    peaceLove:   ['sum', (d) => d.peaceCount, ' 次'],
    chain:       ['game', (d) => d.maxSingleStockPeak, ' 张/局'],
    multiMerge:  ['sum', (d) => d.multiMergeMax, ' 家'],
    shareHoard:  ['game', (d) => d.buySharesMax, ' 张/局'],
    wolfStreet:  ['sum', (d) => d.winStreakBest, ' 场'],
    underdog:    ['sum', (d) => d.loseStreakBest, ' 场'],

    edge:        ['game', (d) => d.edgeMax, ' 次/局'],
    sleight:     ['game', (d) => d.sleightMax, ' 次/局'],

    dragon:      ['sum', (d) => d.hardWins, ' 胜'],
    blitz:       ['best', (d) => d.fastestWinRound, ' 回合'],
    allIn:       ['sum', (d) => d.allInWins, ' 次'],
    workerKing:  ['sum', (d) => d.workerWins, ' 次'],
    brokeBuyer:  ['score', (d) => d.brokeBest, ''],
    zenKeeper:   ['sum', (d) => d.keepCount, ' 张'],
    wheelKing:   ['sum', (d) => d.swapCount, ' 组'],
    sevenHold:   ['sum', (d) => d.sevenHoldCount, ' 局'],
    poorSoul:    ['sum', (d) => d.poorSoulCount, ' 次'],
    miser:       ['sum', (d) => d.stingyWins, ' 次'],
    timeoutHero: ['sum', (d) => d.autoPlayCount, ' 次'],
    knowThis:    ['sum', (d) => d.knowThisCount, ' 次'],
  };

  /**
   * 某个成就当前的实际进度。
   * 返回 { text } —— 没进度的（数据还没积累）返回空串。
   */
  function progressOf(id) {
    const d = load();
    const spec = PROGRESS[id];
    if (!spec) return '';

    const kind = spec[0];
    const value = spec[1](d) || 0;
    const unit = spec[2] || '';

    if (!value) return '';

    if (kind === 'sum') {
      const shown = unit === '$' ? '$' + value.toLocaleString('en-US') : value + unit;
      return '当前进度 ' + shown;
    }
    if (kind === 'game') return '当前最高 ' + value + unit;
    if (kind === 'best') return '当前最好 ' + value + unit;
    return '当前最高 ' + ['Ⅰ', 'Ⅱ', 'Ⅲ'][Math.min(3, value) - 1] + ' 档';
  }

  root.Career = {
    load: load,
    save: save,
    startMatch: startMatch,
    note: note,
    finishMatch: finishMatch,
    summaryForPanel: summaryForPanel,
    resetAll: resetAll,
    ACHIEVEMENTS: ACHIEVEMENTS,
    progressOf: progressOf,
    recordFrame: recordFrame,
    replays: () => (load().replays || []),
    replay: (id) => (load().replays || []).filter((r) => r.id === id)[0] || null,
    removeReplay: (id) => {
      const d = load();
      d.replays = (d.replays || []).filter((r) => r.id !== id);
      save();
    },
    getMatch: () => match,
  };
})(typeof window !== 'undefined' ? window : globalThis);
