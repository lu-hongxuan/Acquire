/* ==========================================================================
   并购风云 · 右侧「连锁酒店」面板

   只负责把数据画成卡片：不读 state，不改游戏状态。
   依赖由 install() 注入 —— 公司列表会随设置改名，所以用取值函数而非快照。

   从 board.js 抽出来（重构：渲染层第一刀）。
   HTML 结构与抽离前逐字一致，只是把外部标识符换成注入的取值函数。

   对外暴露 window.BoardViewCompanies。
   ========================================================================== */

(function (root) {
  'use strict';

  var deps = null;

  /**
   * @param {object} d
   * @param {function} d.getCompanies () => [{id,name,mark,color,tier}, ...]
   * @param {function} d.getTierNames () => ['小','中','大']
   * @param {function} d.getSafeSize  () => 安全规模
   * @param {function} d.priceOf      (size, companyId) => 股价
   * @param {function} d.hexToRgba    (hex, alpha) => rgba 字符串
   * @param {function} d.qs           (selector) => element
   */
  function install(d) { deps = d; }

  function renderCompanies(sizes) {
    const list = deps.qs('#companyList');
    const companies = deps.getCompanies();
    const tierNames = deps.getTierNames();
    const safeSize = deps.getSafeSize();

    // 按档位分组，每组一个带标签的面板，一眼看出哪几家是同档
    const groups = [0, 1, 2].map((tier) => ({
      tier,
      label: `${tierNames[tier]}规模`,
      items: companies.filter((c) => c.tier === tier),
    }));

    list.innerHTML = groups.filter((g) => g.items.length).map((g) => {
      const cards = g.items.map((c) => {
        const size = sizes[c.id] || 0;
        const active = size > 0;
        const safe = size >= safeSize;
        const price = deps.priceOf(size, c.id);
        const ratio = Math.min(size / safeSize, 1) * 100;

        return `
          <div class="company-card ${active ? 'is-active' : 'is-inactive'}"
               style="--c:${c.color};--c-soft:${deps.hexToRgba(c.color, 0.11)};--c-line:${deps.hexToRgba(c.color, 0.5)}"
               title="${g.label} · ${active ? `规模 ${size} 块 · 股价 $${price}` : '未上市'}">
            <div class="company-badge">${c.mark}</div>
            <div class="company-main">
              <span class="company-name">${c.name}</span>
              <span class="company-sub">${active ? `规模 ${size} 块` : '未上市'}</span>
              <span class="company-bar"><i style="width:${active ? ratio : 0}%"></i></span>
            </div>
            <div class="company-right">
              <span class="company-price">${price ? '$' + price : '—'}</span>
              ${safe ? '<span class="safe-tag">安全</span>' : ''}
            </div>
          </div>`;
      }).join('');

      return `
        <div class="company-group">
          <div class="group-label">
            <i></i><span>${g.label}</span><i></i>
          </div>
          ${cards}
        </div>`;
    }).join('');
  }

  root.BoardViewCompanies = { install: install, render: renderCompanies };
})(typeof window !== 'undefined' ? window : globalThis);
