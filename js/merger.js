/* ==========================================================================
   并购流程 · 显式状态机
   ==========================================================================

   之前的写法是一串嵌套回调：
     stageDividend → stageStocks → applyStocks → completeStep → setTimeout(stageDividend)
   每一步都改全局 merge，任何一步抛异常或漏调用，整个流程就悬在中间，
   没人负责收尾 —— 这就是「分红关不掉」「AI 卡死」的同一个病根。

   现在把「流程控制」单独拿出来：

     状态：idle → choosing → dividend → stocks → absorb → done
     每次只有 step() 一个入口能推进，天然幂等（同一个 loser 不会被处理两次），
     并且内置看门狗（超时强制收尾）。

   本模块只关心「下一步该干什么」，不碰 DOM、不碰渲染 —— 表现层由外部回调提供。
   ========================================================================== */

(function (root) {
  'use strict';

  /** 并购阶段 */
  const STAGE = {
    IDLE: 'idle',
    CHOOSING: 'choosing',   // 规模相同，等发起者选存活方
    DIVIDEND: 'dividend',   // 发分红
    STOCKS: 'stocks',       // 处置股票
    ABSORB: 'absorb',       // 把败方板块并入存活方
    DONE: 'done',
  };

  /*
   * 看门狗只用来抓「真的卡死了」，绝不能误伤「正在等玩家操作」。
   * 所以：
   *   1. 默认给足 120 秒；
   *   2. 等待玩家确认期间会调用 hold() 完全停表。
   */
  const WATCHDOG_MS = 120000;

  let S = null;             // 当前并购的完整状态
  let held = false;         // true = 正在等玩家操作，看门狗停表

  /* --------------------------------------------------------------- 生命周期 */

  /**
   * 开始一次并购。
   * cfg = {
   *   survivors: [companyId],        // 参与并购的公司
   *   survivorId: companyId|null,    // 已确定的存活方（规模相同则为 null，进入 choosing）
   *   sizes: { companyId: n },
   *   handlers: { onStage, onFinish, onError, onToast }
   * }
   */
  function begin(cfg) {
    abort();                                  // 防御：上一场没清理干净

    const sizes = cfg.sizes || {};
    const survivorId = cfg.survivorId || null;
    const losers = (cfg.survivors || [])
      .filter((id) => id !== survivorId)
      .sort((a, b) => (sizes[b] || 0) - (sizes[a] || 0));

    S = {
      survivors: (cfg.survivors || []).slice(),
      survivorId,
      sizes,
      queue: losers,
      index: 0,
      paid: Object.create(null),              // 已发过分红的公司，防止重复发钱
      absorbed: Object.create(null),
      stage: survivorId ? STAGE.DIVIDEND : STAGE.CHOOSING,
      handlers: cfg.handlers || {},
      timer: null,
      startedAt: Date.now(),
    };

    armWatchdog();
    fire('onStage', stageSnapshot());
    return snapshot();
  }

  /** 规模相同 → 发起者选定存活方之后调用 */
  function chooseSurvivor(companyId) {
    if (!S) return null;
    S.survivorId = companyId;
    S.queue = S.survivors
      .filter((id) => id !== companyId)
      .sort((a, b) => (S.sizes[b] || 0) - (S.sizes[a] || 0));
    S.index = 0;
    S.stage = STAGE.DIVIDEND;
    armWatchdog();
    fire('onStage', stageSnapshot());
    return snapshot();
  }

  /** 当前正在处理的被吞并公司 */
  function currentLoser() {
    if (!S) return null;
    return S.queue[S.index] || null;
  }

  /** 进入某个子阶段（发分红 / 处置股票 / 吸收） */
  function enterStage(stage) {
    if (!S) return;
    S.stage = stage;
    armWatchdog();
    fire('onStage', stageSnapshot());
  }

  /**
   * 一个被吞并公司处理完毕。
   * 返回下一个被吞并公司；没有则返回 null 并触发 onFinish。
   */
  function completeLoser() {
    if (!S) return null;

    S.index += 1;
    armWatchdog();

    const next = S.queue[S.index];
    if (!next) {
      finish();
      return null;
    }
    S.stage = STAGE.DIVIDEND;
    fire('onStage', stageSnapshot());
    return next;
  }

  /** 幂等令牌：同一个 key 第一次返回 true，之后返回 false */
  function claim(token) {
    if (!S) return false;
    if (S.paid[token]) return false;
    S.paid[token] = true;
    return true;
  }

  /** 已领取过？ */
  function claimed(token) {
    return !!(S && S.paid[token]);
  }

  function finish() {
    if (!S) return;
    const h = S.handlers;
    const snap = snapshot();
    clearWatchdog();
    S.stage = STAGE.DONE;
    const s = S;
    S = null;
    // 先把状态清掉再回调，回调里再进并购也不会互相污染
    if (h.onFinish) {
      try { h.onFinish(snap); } catch (e) { console.error('[merger onFinish]', e); }
    }
  }

  function abort() {
    clearWatchdog();
    held = false;
    S = null;
  }

  /* --------------------------------------------------------------- 看门狗 */

  function armWatchdog() {
    clearWatchdog();
    if (!S || held) return;
    S.timer = setTimeout(function () {
      S && (S.timer = null);
      if (!S) return;
      console.warn('[merger] watchdog: 超时强制收尾');
      fire('onToast', '并购结算超时，已自动继续');
      finish();
    }, WATCHDOG_MS);
  }

  /** 暂停看门狗：正在等玩家确认，不算卡死 */
  function holdWatchdog() {
    held = true;
    clearWatchdog();
  }

  /** 恢复看门狗：玩家确认完了，继续计时 */
  function releaseWatchdog() {
    held = false;
    if (S) armWatchdog();
  }

  function clearWatchdog() {
    if (S && S.timer) { clearTimeout(S.timer); S.timer = null; }
  }

  /* --------------------------------------------------------------- 内部 */

  function fire(name, payload) {
    if (!S) return;
    const fn = S.handlers[name];
    if (typeof fn !== 'function') return;
    try { fn(payload); } catch (e) { console.error('[merger ' + name + ']', e); }
  }

  function snapshot() {
    if (!S) return { stage: STAGE.DONE };
    return {
      stage: S.stage,
      survivorId: S.survivorId,
      loserId: currentLoser(),
      index: S.index,
      total: S.queue.length,
      queue: S.queue.slice(),
      sizes: S.sizes,
      survivors: S.survivors.slice(),
    };
  }

  function stageSnapshot() {
    return snapshot();
  }

  /* --------------------------------------------------------------- 导出 */

  root.Merger = {
    STAGE: STAGE,
    begin: begin,
    chooseSurvivor: chooseSurvivor,
    currentLoser: currentLoser,
    enterStage: enterStage,
    completeLoser: completeLoser,
    claim: claim,
    claimed: claimed,
    finish: finish,
    abort: abort,
    holdWatchdog: holdWatchdog,
    releaseWatchdog: releaseWatchdog,
    get state() { return snapshot(); },
    get active() { return !!S; },
    survivorId: function () { return S ? S.survivorId : null; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
