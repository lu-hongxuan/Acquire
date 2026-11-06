/* ==========================================================================
   并购风云 · 悬停提示框

   为什么不用浏览器自带的 title：
     原生提示框是纯白的、位置完全由系统决定、不能放图片，也不能做「充能」反馈。
     这里自己画一个，顺便把「精美股票证书」这类内容也装进来。

   交互规则（按设计需求）：
     1. 鼠标停住 delayMs（默认 300ms）→ 光标旁出现充能环
     2. 环在 500ms 内充满 → 弹出面板
     3. 鼠标在面板内移动不关闭；离开面板（且不在原元素上）才关闭
     4. 快速划过多个元素不触发 —— 只要换了目标，计时全部作废
     5. 靠右/靠下时自动翻到另一侧，绝不被屏幕裁切
     6. 层级压过所有弹窗、扫光、证书

   用法：
     Tooltip.register('tile', (el) => ({ title, html, meta }))   // 返回 null 就不显示
     <div data-tip="tile" data-c="3" data-r="2">
   ========================================================================== */

(function (root) {
  'use strict';

  var DWELL_DEFAULT = 300;   // 停留多久开始充能
  var CHARGE_MS = 500;       // 充能环充满所需时间
  var GAP = 14;              // 面板与光标的间距
  var MARGIN = 10;           // 与屏幕边缘的最小距离

  var providers = Object.create(null);
  var dwell = DWELL_DEFAULT;

  var ringEl = null;
  var panelEl = null;
  var anchorEl = null;
  var dwellTimer = 0;
  var chargeTimer = 0;
  var lastX = 0;
  var lastY = 0;
  var installed = false;

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  /* ------------------------------------------------------------ 充能环 */

  function ensureRing() {
    if (ringEl) return ringEl;
    ringEl = el('div', 'tip-ring');
    document.body.appendChild(ringEl);
    return ringEl;
  }

  function showRing(x, y) {
    var ring = ensureRing();
    ring.classList.remove('is-charging');
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.style.opacity = '1';
    // 强制回流，让动画能重新开始
    void ring.offsetWidth;
    ring.classList.add('is-charging');
  }

  function hideRing() {
    if (!ringEl) return;
    ringEl.classList.remove('is-charging');
    ringEl.style.opacity = '0';
  }

  /* ------------------------------------------------------------ 面板 */

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = el('div', 'tip-panel');
    panelEl.setAttribute('role', 'tooltip');
    panelEl.addEventListener('mouseenter', function () {
      // 进入面板就取消关闭计时
      clearTimeout(chargeTimer);
    });
    panelEl.addEventListener('mouseleave', function (e) {
      if (anchorEl && anchorEl.contains(e.relatedTarget)) return;
      close();
    });
    document.body.appendChild(panelEl);
    return panelEl;
  }

  function close() {
    clearTimeout(dwellTimer);
    clearTimeout(chargeTimer);
    dwellTimer = 0;
    chargeTimer = 0;
    anchorEl = null;
    hideRing();
    if (panelEl) {
      panelEl.classList.remove('is-open');
      panelEl.style.display = 'none';
    }
  }

  /** 放面板：先按下方右侧试，空间不够就翻转，最后再做一次边界夹取 */
  function place(panel, x, y) {
    panel.style.display = 'block';
    panel.style.left = '0px';
    panel.style.top = '0px';

    var w = panel.offsetWidth;
    var h = panel.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var left = x + GAP;
    var top = y + GAP;

    // 右边放不下 → 翻到光标左侧
    if (left + w > vw - MARGIN) left = x - w - GAP;
    // 下面放不下 → 翻到光标上方
    if (top + h > vh - MARGIN) top = y - h - GAP;

    // 极端情况下（面板比屏幕还大）直接夹到边界内
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));

    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function renderInto(panel, data) {
    var html = '';
    if (data.title) {
      html += '<div class="tip-head">' + data.title + '</div>';
    }
    if (data.html) html += '<div class="tip-body">' + data.html + '</div>';
    if (data.meta) html += '<div class="tip-meta">' + data.meta + '</div>';
    panel.innerHTML = html;
    panel.classList.remove('tip-panel--plain');
    if (data.plain) panel.classList.add('tip-panel--plain');
  }

  function open(target, data) {
    var panel = ensurePanel();
    hideRing();
    renderInto(panel, data);
    place(panel, lastX, lastY);
    /*
     * 同步加权：先移除再强制回流，让 CSS 过渡能从「关」的状态开始。
     * 不用 requestAnimationFrame —— 它在后台标签页/虚拟时间里会被推迟，
     * 表现为「面板算好了但一直不显示」。
     */
    panel.classList.remove('is-open');
    void panel.offsetWidth;
    panel.classList.add('is-open');
  }

  /* ------------------------------------------------------------ 事件 */

  function resolverFor(node) {
    var host = node && node.closest ? node.closest('[data-tip]') : null;
    if (!host) return null;
    var kind = host.dataset.tip;
    var fn = providers[kind];
    if (!fn) return null;
    return { host: host, fn: fn };
  }

  function onMove(e) {
    lastX = e.clientX;
    lastY = e.clientY;

    // 鼠标在面板里：保持显示
    if (panelEl && panelEl.classList.contains('is-open') && panelEl.contains(e.target)) {
      return;
    }

    var hit = resolverFor(e.target);
    var host = hit ? hit.host : null;

    // 已经显示着的面板，指针离开锚点也没进入面板 → 关闭
    if (panelEl && panelEl.classList.contains('is-open') && host !== anchorEl) {
      close();
    }

    if (host === anchorEl) return;             // 还是同一个元素，什么都不做

    // 换了目标：之前的一切作废（防抖）
    clearTimeout(dwellTimer);
    clearTimeout(chargeTimer);
    hideRing();
    anchorEl = host;

    if (!host) return;

    dwellTimer = setTimeout(function () {
      var data = hit.fn(host);
      if (!data) { anchorEl = null; return; }

      showRing(lastX, lastY);
      chargeTimer = setTimeout(function () {
        open(host, data);
      }, CHARGE_MS);
    }, dwell);
  }

  function onLeave(e) {
    // 指针离开窗口
    if (!e.relatedTarget) close();
  }

  function onScroll() { close(); }

  function install() {
    if (installed) return;
    installed = true;

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseleave', onLeave, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);

    // 切屏 / 关弹窗时顺手关掉，避免残留
    document.addEventListener('click', close, true);
  }

  /* ------------------------------------------------------------ 对外 */

  function register(kind, fn) {
    providers[kind] = fn;
  }

  function setDelay(ms) {
    dwell = Math.max(0, Number(ms) || 0);
  }

  root.Tooltip = {
    install: install,
    register: register,
    setDelay: setDelay,
    close: close,
    getDelay: function () { return dwell; },
    CHARGE_MS: CHARGE_MS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
