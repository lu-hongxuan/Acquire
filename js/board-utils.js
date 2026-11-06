/* ==========================================================================
   并购风云 · 桌面通用工具

   不读游戏状态的纯函数：公司名解析、生涯面板 HTML。
   需要的数据由调用方传入，不自己抓全局。

   从 board.js 抽出来（重构：补齐计划第一步）。
   对外暴露 window.BoardUtils。
   ========================================================================== */

(function () {
  'use strict';

  /**
   * 公司 id → 显示名。找不到就原样返回 id，方便排错。
   * @param {string} id
   * @param {object} byId 形如 { saxony: {name: '萨克森'}, ... }
   */
  function companyName(id, byId) {
    return (byId && byId[id]) ? byId[id].name : id;
  }

  /**
   * 终局弹窗里的「生涯与成就」折叠面板。
   * @param {Array} newly 本局新解锁的成就（可能为空）
   */
  function buildCareerPanel(newly) {
    if (!window.Career) return '';

    const sum = window.Career.summaryForPanel ? window.Career.summaryForPanel() : null;
    if (!sum) return '';

    const achCards = (newly && newly.length)
      ? newly.map((a) => `
          <div class="ach-mini is-new">
            <span class="ach-mini-tier">${a.tier || '★'}</span>
            <b>${a.name}</b>
            <em>本局解锁</em>
          </div>`).join('')
      : '<p class="ach-none">本局没有新解锁的成就，再接再厉。</p>';

    const cells = [
      ['总对局', sum.games],
      ['胜场', sum.wins],
      ['平均排名', sum.avgRank],
      ['最高净资产', '$' + (sum.bestNet || 0).toLocaleString('en-US')],
    ].map(([k, v]) => `<div class="career-mini-cell"><i>${k}</i><b>${v}</b></div>`).join('');

    return `
      <details class="career-fold">
        <summary>
          <span class="fold-title">生涯与成就</span>
          <span class="fold-hint">本局解锁 ${(newly || []).length} 项 · 点击展开</span>
        </summary>
        <div class="career-fold-body">
          <div class="ach-mini-grid">${achCards}</div>
          <div class="career-mini-grid">${cells}</div>
        </div>
      </details>`;
  }

  window.BoardUtils = {
    companyName: companyName,
    buildCareerPanel: buildCareerPanel,
  };
})();
