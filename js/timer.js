/* ==========================================================================
   回合计时 · 单一数据源
   ==========================================================================

   之前计时散在 board.js 里：timerKey / timerDeadline / timerGraceUntil /
   timerRunning / lastTick 五个模块级变量，加上 paintTurnTimer、tickTurnTimer、
   resetTurnTimer 三个函数互相读写，谁都能改，于是出现
   「先充满再退回」「AI 条不动」「超时代打错人」这些互相牵制的问题。

   现在计时只在这里维护，外部只读 ratio，不再碰内部变量。

   语义（对应现实）：
     - 每个「玩家 + 阶段」都是一次新的等待窗口，换人就重置
     - 窗口走完还有一段宽限期，宽限期内不强制代打
     - 弹窗打开 = 暂停（时间不流逝）
   ========================================================================== */

(function (root) {
  'use strict';

  const GRACE_MS = 5000;

  let total = 0;          // 本次窗口总时长（毫秒）
  let deadline = 0;       // 截止时刻（绝对时间）
  let graceUntil = 0;     // 宽限截止
  let key = '';           // 当前窗口标识：玩家:阶段:动作序号
  let running = false;
  let paused = false;
  let lastNow = 0;

  /* --------------------------------------------------------------- 控制 */

  /** 重置窗口。key 变了或主动要求重置时调用 */
  function reset(nextKey, seconds) {
    key = nextKey || '';
    total = Math.max(1000, (seconds || 35) * 1000);
    deadline = Date.now() + total;
    graceUntil = 0;
    running = true;
    lastNow = Date.now();
  }

  /**
   * 每帧调用。返回当前状态，方便调用方决定要不要代打。
   * { key, ratio, left, expired, graceLeft, inGrace }
   */
  function tick(nextKey, seconds) {
    // 换人 / 换阶段 → 立刻开新窗口，绝不让上一手的截止时间带过来
    if (nextKey && nextKey !== key) reset(nextKey, seconds);

    const now = Date.now();
    const delta = lastNow ? now - lastNow : 0;
    lastNow = now;

    if (paused || !running) {
      if (deadline) deadline += delta;
      if (graceUntil) graceUntil += delta;
      return status();
    }

    if (!deadline) return status();

    if (now >= deadline && !graceUntil) {
      graceUntil = deadline + GRACE_MS;
      return status({ justExpired: true });
    }

    if (graceUntil && now >= graceUntil) {
      running = false;
      return status({ justOver: true });
    }

    return status();
  }

  function status(extra) {
    const now = Date.now();
    const left = deadline - now;
    const ratio = deadline ? Math.max(0, Math.min(1, left / total)) : 1;

    return Object.assign({
      key: key,
      ratio: ratio,
      left: left,
      total: total,
      expired: left <= 0,
      inGrace: left <= 0 && !!graceUntil,
      graceLeft: graceUntil ? Math.max(0, graceUntil - now) : 0,
    }, extra || {});
  }

  function pause() { paused = true; }
  function resume() { paused = false; lastNow = Date.now(); }

  function stop() {
    running = false;
    paused = false;
    deadline = 0;
    graceUntil = 0;
    key = '';
    total = 0;
  }

  function ratio() {
    if (!deadline) return 1;
    return Math.max(0, Math.min(1, (deadline - Date.now()) / total));
  }

  function isRunning() { return running && !paused; }

  root.TurnTimer = {
    GRACE_MS: GRACE_MS,
    reset: reset,
    tick: tick,
    status: status,
    pause: pause,
    resume: resume,
    stop: stop,
    ratio: ratio,
    isRunning: isRunning,
    get key() { return key; },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
