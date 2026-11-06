/* ==========================================================================
   并购风云 · 底部操作区（你的钱袋 + 持股）

   只负责写 DOM：头像、名字、现金、回合数、两个按钮的文案与可用性、
   持股卡与合计。所有判断（轮到谁、能不能买、会不会结束）都在调用方。

   视图对象：
     {
       avatarIndex: number, avatarColor: string,
       name: string, cashText: string, roundNo: number,
       highlight: boolean,                 // 轮到你了
       buy: { text, disabled },
       end: { text, disabled },
       holdingsHTML: string,               // 已拼好的股票卡
       holdingsHint: string,               // 「共 N 张」
     }

   从 board.js 抽出来（重构：渲染层第五刀）。
   对外暴露 window.BoardViewTray。
   ========================================================================== */

(function (root) {
  'use strict';

  var deps = null;

  /** @param {object} d @param {function} d.qs */
  function install(d) { deps = d; }

  function render(v) {
    var qs = (deps && deps.qs) || function (sel) { return document.querySelector(sel); };

    var avatar = qs('#trayAvatar');
    if (avatar) {
      avatar.textContent = String(v.avatarIndex + 1);
      avatar.style.setProperty('--p', v.avatarColor);
    }

    var nameEl = qs('#trayName');
    if (nameEl) nameEl.textContent = v.name;

    var cashEl = qs('#cashValue');
    if (cashEl) cashEl.textContent = v.cashText;

    var roundEl = qs('#roundNo');
    if (roundEl) roundEl.textContent = String(v.roundNo);

    var trayBox = document.querySelector('.tray-player');
    if (trayBox) trayBox.classList.toggle('is-current', !!v.highlight);

    var buyBtn = qs('#btnBuy');
    if (buyBtn) {
      buyBtn.disabled = !!v.buy.disabled;
      buyBtn.textContent = v.buy.text;
    }

    var endBtn = qs('#btnEndTurn');
    if (endBtn) {
      endBtn.textContent = v.end.text;
      endBtn.disabled = !!v.end.disabled;
    }

    var list = qs('#holdingList');
    if (list) {
      /*
       * 只在内容真的变了才重写。
       *
       * 每次都整体重写的话节点会被替换：鼠标正悬停在某张股票卡上
       * （CSS :hover 让它上浮），旁边的人一出牌、下一阶段触发 render，
       * 旧节点被销毁 —— hover 状态随之丢失，新节点要等下一次鼠标移动
       * 才重新判定。看上去就是「沉下去、又浮起来」。
       *
       * 阶段变化不改持股内容，所以这种情况直接跳过。
       */
      if (list.__holdingsHTML !== v.holdingsHTML) {
        list.innerHTML = v.holdingsHTML;
        list.__holdingsHTML = v.holdingsHTML;
      }

      var hint = qs('#holdingHint');
      if (hint) hint.textContent = v.holdingsHint;
    }
  }

  root.BoardViewTray = { install: install, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
