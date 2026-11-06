/* ==========================================================================
   并购风云 · 座位卡

   座位元素**只创建一次**，之后原地更新内容。

   为什么不能每次重建：
     每次 render 都用 innerHTML 重造座位，等于把整个卡片（包括金色描边阴影）
     丢掉再画一遍，浏览器在重绘的那一帧会露出未着色状态 —— 看上去就是
     「高亮瞬间变暗一下」。同时元素新建会让补牌动画重新播放，像「跳一下」。

   现在：
     - 座位根节点常驻，只改 class / 文本 / 子结构
     - 只有手牌数变化时才重建那排小方块（这样新补的那格才会播动画）
     - 持股按「签名」判断是否需要重建

   视图对象与调用方式不变（见 render）。

   从 board.js 抽出来（重构：渲染层第四刀）。
   对外暴露 window.BoardViewSeats。
   ========================================================================== */

(function (root) {
  'use strict';

  var deps = null;

  /** @param {object} d @param {function} d.qs */
  function install(d) { deps = d; }

  /** 每个座位号对应的常驻节点 */
  var seatEls = Object.create(null);
  /** 上一次各容器里的座位顺序，用来判断是否需要挪动 */
  var lastOrder = { top: '', left: '', right: '' };
  /** 上一次手牌数，用来判断是否需要重建那排小方块 */
  var lastTiles = Object.create(null);

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  /** 建一个空壳，之后只往里填内容 */
  function createSeat(index) {
    var seat = el('div', 'seat');
    seat.dataset.p = String(index);

    var main = el('div', 'seat-main');
    var avatar = el('div', 'seat-avatar');
    avatar.textContent = String(index + 1);

    var body = el('div', 'seat-body');
    var name = el('span', 'seat-name');
    var cash = el('span', 'seat-cash');
    body.appendChild(name);
    body.appendChild(cash);

    var tiles = el('div', 'seat-tiles');

    var progress = el('span', 'seat-progress');
    progress.appendChild(el('i'));


    main.appendChild(avatar);
    main.appendChild(body);
    main.appendChild(tiles);
    main.appendChild(progress);

    var holdings = el('div', 'seat-holdings');

    seat.appendChild(main);
    seat.appendChild(holdings);

    return {
      root: seat,
      avatar: avatar,
      name: name,
      cash: cash,
      tiles: tiles,
      progress: progress,
      progressBar: progress.firstChild,
      holdings: holdings,
      tilesCount: -1,
      holdingsSig: null,
    };
  }

  /** 更新某个座位（原地） */
  function paint(s, v) {
    s.root.className = 'seat' + (v.isCurrent ? ' is-current' : '');
    s.root.style.setProperty('--p', v.color);
    s.root.title = v.name + (v.cashHidden ? '' : ' · 现金 ' + v.cashText);

    s.name.textContent = v.name;
    if (!v.isHuman && !s.name.querySelector('.ai-tag')) {
      var tag = el('em', 'ai-tag');
      tag.textContent = 'AI';
      s.name.appendChild(tag);
    } else if (v.isHuman) {
      var old = s.name.querySelector('.ai-tag');
      if (old) old.remove();
    }

    s.cash.textContent = v.cashText;
    s.cash.classList.toggle('is-hidden', !!v.cashHidden);

    /* 手牌小方块：只有数量变化时才重建（这样新补的那格才会播动画） */
    if (s.tilesCount !== v.handCount || s.tiles.childElementCount !== v.slots) {
      s.tiles.innerHTML = '';
      for (var i = 0; i < v.slots; i++) {
        var pip = el('i', i >= v.handCount ? 'is-empty' : 'has-tile');
        if (v.justDrew && i === v.handCount - 1) pip.classList.add('is-new');
        s.tiles.appendChild(pip);
      }
      s.tiles.setAttribute('aria-label', '手牌 ' + v.handCount + ' 块');
      s.tilesCount = v.handCount;
    } else if (v.justDrew) {
      // 数量没变（例如刚补又被弃），把最后一格点亮提醒一下
      var last = s.tiles.lastElementChild;
      if (last) {
        last.classList.remove('is-new');
        void last.offsetWidth;
        last.classList.add('is-new');
      }
    }

    /* 进度条：只改宽度，不重建 */
    s.progress.style.display = v.showProgress ? '' : 'none';
    if (v.showProgress) {
      s.progressBar.id = 'seatBar' + v.index;
      s.progressBar.style.width = Math.round(v.progressPercent) + '%';
    }

    /* 持股：按签名判断要不要重建 */
    var sig;
    if (v.holdings === null) sig = 'hidden';
    else sig = v.holdings.map(function (c) { return c.mark + c.count; }).join('|');

    if (s.holdingsSig !== sig) {
      s.holdings.innerHTML = '';

      if (v.holdings === null) {
        var chip = el('span', 'seat-chip is-hidden');
        chip.textContent = '持股隐藏';
        s.holdings.appendChild(chip);
      } else {
        v.holdings.forEach(function (c) {
          var chip2 = el('span', 'seat-chip');
          chip2.style.setProperty('--c', c.color);
          chip2.title = c.name + ' ' + c.count + ' 张';
          chip2.textContent = c.mark + c.count;
          s.holdings.appendChild(chip2);
        });
      }
      s.holdingsSig = sig;
    }
  }

  /**
   * 把一个容器里的座位排成指定顺序。
   * 已存在的节点直接复用（appendChild 会把它挪过去），不重建。
   */
  function place(container, list, seats) {
    if (!container) return;

    var key = list.join(',');
    var changed = lastOrder[container.id] !== key;

    if (changed) {
      // 先把不属于当前布局的节点移走
      Array.prototype.slice.call(container.children).forEach(function (node) {
        if (list.indexOf(Number(node.dataset.p)) < 0) node.remove();
      });
      list.forEach(function (idx) {
        container.appendChild(seatOf(idx, seats).root);
      });
      lastOrder[container.id] = key;
    } else {
      // 顺序没变：只刷新内容，DOM 一动不动
      list.forEach(function (idx) { seatOf(idx, seats); });
    }

    container.style.display = list.length ? '' : 'none';
  }

  /** 取（或创建）某个座位的常驻节点 */
  function seatOf(index, seats) {
    if (!seatEls[index]) seatEls[index] = createSeat(index);
    paint(seatEls[index], seats[index]);
    return seatEls[index];
  }

  function render(v) {
    var qs = (deps && deps.qs) || function (sel) { return document.querySelector(sel); };

    place(qs('#seatsTop'), v.buckets.top, v.seats);
    place(qs('#seatsLeft'), v.buckets.left, v.seats);
    place(qs('#seatsRight'), v.buckets.right, v.seats);
  }

  root.BoardViewSeats = { install: install, render: render };
})(typeof window !== 'undefined' ? window : globalThis);
