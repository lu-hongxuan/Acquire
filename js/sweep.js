/* ==========================================================================
   并购风云 · 归属变化扫光

   设计依据《扫光特效与回合冲突：正确重做思路》：

   1. 触发条件不是「放置了板块」，而是「格子归属发生了变化」。
      所以这里提供 snapshot / diff：操作前拍一份棋盘，操作后再拍一份，
      两份不同的坐标就是这次真正发生变化的格子。

   2. 扫光是表现层的事，业务层（回合推进）不许打断它。
      每个格子有独立的定时器与 DOM 节点，谁都不影响谁。

   3. 同一个格子短时间多次变化时，后来的吞掉先前的：
      启动前先销毁该格子上已有的实例。

   4. 用一个真实 DOM 节点（span.cell-sweep）而不是伪元素，
      因为该格子的 ::before 已经在画公司斜纹、::after 在画悬停预览，
      再占用就会互相覆盖（这就是「扫光期间斜纹消失」的原因）。

   对外暴露 window.Sweep。
   ========================================================================== */

(function () {
  'use strict';

  var deps = null;

  var DELAY = 1000;      // 归属变化后多久开始扫
  var DURATION = 900;    // 与 CSS 动画时长保持一致

  /** key('3,4') → { timer, node, startedAt } */
  var instances = Object.create(null);

  /** 正在播的格子：key → 开始时间。render 重建 DOM 后要用它把动画贴回去 */
  var active = Object.create(null);

  /**
   * @param {object} d
   * @param {function} d.getBoard    () => state.game.board
   * @param {function} d.getCellEls  () => 格子节点数组（按 r*COLS+c 索引）
   * @param {function} d.cols        () => 棋盘列数
   */
  function install(d) { deps = d; }

  /** 拍一份归属快照 */
  function snapshot() {
    var b = deps.getBoard();
    var snap = Object.create(null);
    for (var k in b) snap[k] = b[k];
    return snap;
  }

  /**
   * 与快照比对，返回归属发生变化的格子 key 列表。
   * 注意：undefined（无板块）→ null（零散板块）也算变化，
   * 所以用「键是否存在」判断，而不是只看值。
   */
  function diff(snap) {
    var b = deps.getBoard();
    var out = [];

    for (var k in b) {
      if (!(k in snap) || snap[k] !== b[k]) out.push(k);
    }
    for (var k2 in snap) {
      if (!(k2 in b)) out.push(k2);
    }
    return out;
  }

  function cellOf(key) {
    var parts = key.split(',');
    var c = Number(parts[0]);
    var r = Number(parts[1]);
    var els = deps.getCellEls();
    if (!els) return null;
    return els[r * deps.cols() + c] || null;
  }

  function detach(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function makeNode(key, elapsed) {
    var cell = cellOf(key);
    if (!cell) return null;

    var node = document.createElement('span');
    node.className = 'cell-sweep';
    // 重新贴回时用负延迟，从上次的进度接着播，不从头闪
    if (elapsed > 0) node.style.animationDelay = '-' + elapsed + 'ms';

    node.addEventListener('animationend', function () {
      detach(node);
      delete active[key];
      var rec = instances[key];
      if (rec && rec.node === node) delete instances[key];
    }, { once: true });

    cell.appendChild(node);
    return node;
  }

  function start(key) {
    var rec = instances[key];
    if (!rec) return;

    var node = makeNode(key, 0);
    if (!node) { delete instances[key]; return; }

    rec.node = node;
    rec.startedAt = Date.now();
    active[key] = rec.startedAt;
  }

  /** 收到一批「归属变化」的坐标，统一延后启动；同格覆盖旧实例 */
  function queue(keys) {
    (keys || []).forEach(function (key) {
      var old = instances[key];
      if (old) {
        if (old.timer) clearTimeout(old.timer);
        detach(old.node);
        delete instances[key];
        delete active[key];
      }

      instances[key] = {
        timer: setTimeout(function () { start(key); }, DELAY),
        node: null,
        startedAt: 0,
      };
    });
  }

  /**
   * render() 会重建所有格子节点，正在播的扫光会跟着消失。
   * 这里按「已经播了多久」把它们贴到新节点上，回合推进不再打断动画。
   */
  function reattach() {
    Object.keys(active).forEach(function (key) {
      var elapsed = Date.now() - active[key];

      if (elapsed >= DURATION) { delete active[key]; return; }

      var cell = cellOf(key);
      if (!cell) return;
      if (cell.querySelector('.cell-sweep')) return;   // 已经贴过了

      var node = makeNode(key, elapsed);
      if (!node) return;
      if (instances[key]) instances[key].node = node;
    });
  }

  window.Sweep = {
    install: install,
    snapshot: snapshot,
    diff: diff,
    queue: queue,
    reattach: reattach,
    DELAY: DELAY,
    DURATION: DURATION,
  };
})();
