/* ==========================================================================
   并购风云 · 手牌区

   只负责画：拿到一份视图对象，写 DOM。
   不读 state、不判断回合、不做游戏逻辑 —— 那些都在调用方（board.js）。

   视图对象：
     {
       tiles:    [{ label, selected, isNew }],   // 手牌坐标文字、是否选中、是否刚补
       lockHand: boolean,                 // 锁住（非放置阶段 / 不是你的回合 / 已结束）
       slots:    number,                  // 牌位总数（手牌 + 占位框）
       hasSelection: boolean,             // 当前是否选中了某张牌
       deckLeft: number,                  // 剩余板块数
       discard:  { disabled, title }      // 弃牌按钮状态
     }

   从 board.js 抽出来（重构：渲染层第二刀）。
   对外暴露 window.BoardViewHand。
   ========================================================================== */

(function (root) {
  'use strict';

  var deps = null;

  /** @param {object} d @param {function} d.qs */
  function install(d) { deps = d; }

  function render(v) {
    var qs = (deps && deps.qs) || function (sel) { return document.querySelector(sel); };

    /* 手牌：牌位总数恒定，打出一张和补一张都不会改变宽度 */
    var tilesHTML = v.tiles.map(function (t, i) {
      return ''
        + '<button class="hand-tile ' + (t.selected ? 'is-selected' : '') + ' ' + (v.lockHand ? 'is-locked' : '') + ' ' + (t.isNew ? 'is-new' : '') + '"'
        + ' data-index="' + i + '"'
        + ' title="' + t.label + '"'
        + (v.lockHand ? ' disabled' : '')
        + '>' + t.label + '</button>';
    }).join('');

    var emptyCount = Math.max(0, v.slots - v.tiles.length);
    var emptyHTML = '';
    for (var i = 0; i < emptyCount; i++) {
      emptyHTML += '<span class="hand-slot" aria-hidden="true"></span>';
    }

    var box = qs('#handTiles');
    // 手牌没变化时不要重写：否则悬停 / 焦点状态会被整体重置
    if (box && box.__handHTML !== tilesHTML + emptyHTML) {
      box.innerHTML = tilesHTML + emptyHTML;
      box.__handHTML = tilesHTML + emptyHTML;
    }

    var handBox = document.querySelector('.tray-hand');
    if (handBox) handBox.style.setProperty('--slot-count', v.slots);

    document.body.classList.toggle('has-selection', !!v.hasSelection);

    var deckEl = qs('#deckLeft');
    if (deckEl) deckEl.textContent = String(v.deckLeft);

    var discardBtn = qs('#btnDiscard');
    if (discardBtn && v.discard) {
      discardBtn.disabled = !!v.discard.disabled;
      discardBtn.title = v.discard.title;
    }
  }

  root.BoardViewHand = { install: install, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
