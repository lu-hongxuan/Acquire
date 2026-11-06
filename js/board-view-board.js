/* ==========================================================================
   并购风云 · 棋盘格子

   只负责按「每格归属」刷新格子外观：颜色、坐标文字颜色、提示、目标格高亮。
   不读 state，不改游戏数据。

   视图对象：
     {
       cells:      [element],              // 格子节点数组（调用方持有，扫光模块也用同一份）
       target:     { c, r, legal } | null, // 选中手牌后该亮的格子
       tileAt:     (c, r) => value,        // undefined=空 / null=零散 / 公司 id
       coordLabel: (c, r) => 'D4',
       companyById: { saxony: {name, color}, ... },
       isLight:    (hex) => bool,
       safeSize:   number,
       sizes:      { companyId: 块数 },
     }

   从 board.js 抽出来（重构：渲染层第三刀）。
   对外暴露 window.BoardViewBoard。
   ========================================================================== */

(function (root) {
  'use strict';

  function render(v) {
    var target = v.target;
    var cells = v.cells || [];

    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var c = Number(cell.dataset.c);
      var r = Number(cell.dataset.r);
      var val = v.tileAt(c, r);

      cell.className = 'cell';
      cell.dataset.tip = 'tile';       // 悬停看归属公司、规模、已售/剩余股票
      cell.style.removeProperty('--c');
      cell.style.removeProperty('--coord');
      cell.removeAttribute('title');

      // 选中手牌后，只有它自己的坐标会亮起来
      if (target && target.c === c && target.r === r) {
        cell.classList.add('is-target');
        if (!target.legal) cell.classList.add('is-blocked');
      }

      if (val === undefined) continue;

      if (val === null) {
        cell.classList.add('is-occupied', 'is-neutral');
        cell.setAttribute('aria-label', '零散板块 ' + v.coordLabel(c, r));
      } else {
        var company = v.companyById[val];
        cell.classList.add('is-occupied', 'is-company');
        cell.style.setProperty('--c', company.color);
        cell.style.setProperty('--coord', v.isLight(company.color)
          ? 'rgba(20, 12, 2, 0.72)'
          : 'rgba(255, 255, 255, 0.82)');
        if (v.sizes[val] >= v.safeSize) cell.classList.add('is-safe');
        cell.setAttribute('aria-label', company.name + ' ' + v.coordLabel(c, r));
      }
    }
  }

  root.BoardViewBoard = { render: render };
})(typeof window !== 'undefined' ? window : globalThis);
