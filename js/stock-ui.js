/* ==========================================================================
   并购风云 · 股票处置界面片段

   只负责把数据拼成 HTML，不读全局 state、不发请求、没有副作用。
   数据由调用方传入（依赖注入），方便单独测试与复用。

   从 board.js 抽出来（重构第二步）。
   对外暴露 window.StockUI。
   ========================================================================== */

(function () {
  'use strict';

  /** 公司小徽章 */
  function badge(co) {
    return '<i class="mix-badge" style="--c:' + co.color + '">' + co.mark + '</i>';
  }

  /**
   * 三张图的说明区：套现 / 置换 / 保留。
   *
   * @param {object} ctx
   * @param {object} ctx.loser      被吞并公司 {color, mark}
   * @param {object} ctx.survivor   存活公司   {color, mark}
   * @param {string} ctx.loserName
   * @param {string} ctx.survivorName
   * @param {number} ctx.price      被吞并公司当前每张股价
   * @param {number} ctx.pool       存活公司剩余股票数
   */
  function guideHTML(ctx) {
    var L = ctx.loser;
    var S = ctx.survivor;

    return [
      '<div class="stock-guide">',

      '<div class="guide-item guide-item--sell">',
      '<span class="guide-visual">' + badge(L)
        + '<span class="guide-arrow">→</span><span class="guide-cash">$</span></span>',
      '<b>套现</b><em>1 张换现价</em>',
      '</div>',

      '<div class="guide-item guide-item--swap">',
      '<span class="guide-visual">' + badge(L) + badge(L)
        + '<span class="guide-arrow">→</span>' + badge(S) + '</span>',
      '<b>置换</b>',
      '<em>2 张' + ctx.loserName + ' 换 1 张' + ctx.survivorName + '</em>',
      '</div>',

      '<div class="guide-item guide-item--keep">',
      '<span class="guide-visual">' + badge(L)
        + '<span class="guide-arrow">→</span><span class="guide-lock">锁</span></span>',
      '<b>保留</b><em>等它复活</em>',
      '</div>',

      '</div>',

      '<p class="guide-note">',
      badge(L),
      ctx.loserName + ' 现价 <b>$' + ctx.price + '</b> / 张',
      '</p>',

      '<p class="guide-pool">',
      badge(S),
      ctx.survivorName + ' 剩余股票 <b>' + ctx.pool + '</b> 张',
      '</p>',
    ].join('');
  }

  /**
   * AI 的处置行：和玩家行同构的三格（套现 / 置换 / 保留），只读。
   * dec 为空表示还没轮到它，显示占位横线。
   *
   * @param {object} ctx
   * @param {object} ctx.player      {name, color}
   * @param {number} ctx.count       持有张数
   * @param {number} ctx.index       玩家序号（用于 data-p）
   * @param {object|null} ctx.dec    {sell, swaps, keep}
   * @param {number} ctx.sellPrice
   * @param {string} ctx.voteBtn     确认按钮的 HTML
   */
  function aiRowHTML(ctx) {
    var dec = ctx.dec;
    var thinking = !dec;
    var sell = thinking ? null : (dec.sell || 0);
    var swaps = thinking ? null : (dec.swaps || 0);
    var keep = thinking ? null : (dec.keep || 0);

    var num = function (v) { return thinking ? '—' : String(v); };
    var gain = (thinking || sell <= 0)
      ? ''
      : '+' + '$' + (sell * ctx.sellPrice).toLocaleString('en-US');

    /*
     * ctx.isAi === false 时不打 AI 标、也不加 is-ai 样式。
     * 结算完人类那一行也会用这个函数整行重画 —— 之前无条件加标，
     * 于是真人确认之后名字后面也冒出「AI」。
     */
    var isAi = ctx.isAi !== false;

    return ''
      + '<div class="stock-row' + (isAi ? ' is-ai' : '') + (thinking ? ' is-thinking' : '') + '" data-p="' + ctx.index + '">'
      + '<span class="stock-who" style="--p:' + ctx.player.color + '">'
      + ctx.player.name + (isAi ? '<em class="ai-tag">AI</em>' : '') + '</span>'
      + '<span class="stock-count">持有 ' + ctx.count + ' 张</span>'
      + '<span class="stock-split">'
      + '<span class="split-item is-sell"><em>套现</em><b class="v-sell">' + num(sell) + '</b>'
      + '<span class="split-gain">' + gain + '</span></span>'
      + '<span class="split-item"><em>置换</em><b class="v-swap">' + num(swaps) + '</b></span>'
      + '<span class="split-item"><em>保留</em><b class="v-keep">' + num(keep) + '</b></span>'
      + '</span>'
      + ctx.voteBtn
      + '</div>';
  }

  window.StockUI = { guideHTML: guideHTML, aiRowHTML: aiRowHTML };
})();
