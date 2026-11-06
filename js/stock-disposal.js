/* ==========================================================================
   并购风云 · 股票处置的计算部分

   「谁确认了 → 扣谁的股票、加多少现金」这一段逻辑。
   不含界面绘制（那在 stock-ui.js），也不自己持有游戏状态 ——
   状态通过 install() 注入的取值函数访问（依赖注入）。

   从 board.js 抽出来（重构第三步）。
   对外暴露 window.StockDisposal。
   ========================================================================== */

(function () {
  'use strict';

  var deps = null;

  /**
   * @param {object} d
   * @param {function} d.getState          () => state
   * @param {function} d.getMerge          () => merge（可能为 null）
   * @param {function} d.priceOf           (size, companyId) => 股价
   * @param {function} d.companyName       (id) => 显示名
   * @param {function} d.renderTray        () => void
   * @param {function} d.refreshPoolLabel  () => void
   * @param {function} d.completeStep      (loserId) => void
   */
  function install(d) {
    deps = d;
  }

  function S() { return deps.getState(); }
  function M() { return deps.getMerge(); }

  function orderedHolders(companyId) {
    const n = S().players.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const idx = (S().current + i) % n;
      const count = S().players[idx].stocks[companyId] || 0;
      if (count > 0) out.push({ player: idx, count });
    }
    return out;
  }

  /**
   * 结算某一个人的处置。写进 merge.results，之后不再改动。
   *
   * intents（想怎么做）与 results（实际做了什么）分开存放：
   *   - intents 会被「剩余股票数变化」重新钳制，可以被改
   *   - results 是既成事实，任何重算都不许碰它
   * 这样就不会再出现「显示被改回 0，实际却已经换过」的问题。
   */
  function settleStockPlayer(playerIdx) {
    if (!M()) return;

    M().results = M().results || Object.create(null);
    if (M().results[playerIdx]) return;            // 已结算

    const loserId = M().stockLoserId;
    const survivorId = M().survivorId;
    if (!loserId || !survivorId) return;

    const p = S().players[playerIdx];
    const n = p.stocks[loserId] || 0;

    const intent = (M().intents && M().intents[playerIdx]) || { swaps: 0, keep: 0 };
    const pool = S().shares[survivorId] || 0;

    // 置换上限同时受：持有数的一半、存活方剩余股票数 限制
    const swaps = Math.max(0, Math.min(intent.swaps || 0, Math.floor(n / 2), pool));
    const keep = Math.max(0, Math.min(intent.keep || 0, n - swaps * 2));
    const sell = Math.max(0, n - swaps * 2 - keep);
    const unit = deps.priceOf(M().stockSize, loserId) || 0;

    // 先落事实，再做实际扣减
    M().results[playerIdx] = { swaps: swaps, keep: keep, sell: sell, cash: sell * unit };

    if (window.BattleLog) {
      window.BattleLog.add('[并购·股票] ' + p.name
        + ' 套现' + sell + ' / 置换' + swaps + ' / 保留' + keep
        + (sell ? '（+$' + sell * unit + '）' : ''));
    }

    /*
     * 生涯记账（只记你本人）：
     *   stockDispose —— 卖出/置换/保留各多少，用于面板里的「操盘风格」比例
     *   sleight      —— 通过 2换1 把自己换成了存活公司的第一大股东
     */
    if (window.Career && deps.isHuman(playerIdx)) {
      window.Career.note('stockDispose', {
        sell: sell, swap: swaps, keep: keep,
        cashout: sell * unit,      // 暴发户：单次并购的套现收益
      });

      if (swaps > 0) {
        const before = (p.stocks[survivorId] || 0) + swaps;   // 置换前的持股
        let othersMax = 0;
        S().players.forEach((other, i) => {
          if (i === playerIdx) return;
          othersMax = Math.max(othersMax, other.stocks[survivorId] || 0);
        });
        if (before + swaps > othersMax && before <= othersMax) {
          window.Career.note('sleight', {});
        }
      }
    }

    if (swaps > 0) {
      p.stocks[loserId] -= swaps * 2;
      p.stocks[survivorId] = (p.stocks[survivorId] || 0) + swaps;
      S().shares[survivorId] = Math.max(0, pool - swaps);
    }
    if (sell > 0) {
      p.cash += sell * unit;
      p.stocks[loserId] -= sell;
    }
    if ((p.stocks[loserId] || 0) <= 0) delete p.stocks[loserId];

    M().stockTotals = M().stockTotals || { cash: 0, swap: 0 };
    M().stockTotals.cash += sell * unit;
    M().stockTotals.swap += swaps;

    refreshPoolLabel();
    deps.renderTray();
  }

  function applyStocks(loserId, size) {
    if (!M()) return;

    M().stockLoserId = loserId;
    M().stockSize = size;
    M().results = M().results || Object.create(null);

    // 兜底：没走到「确认」的人在这里补结算
    orderedHolders(loserId).forEach((h) => {
      if (!M().results[h.player]) settleStockPlayer(h.player);
    });

    const t = M().stockTotals || { cash: 0, swap: 0 };
    M().lastSummary = `${deps.companyName(loserId)} 并入 ${deps.companyName(M().survivorId)}`
      + (t.cash ? `，套现 $${t.cash.toLocaleString('en-US')}` : '')
      + (t.swap ? `，置换 ${t.swap} 张` : '');

    deps.completeStep(loserId);
  }

  function refreshPoolLabel() {
    if (!M() || !M().survivorId) return;

    const el = document.querySelector('.guide-pool b');
    if (el) el.textContent = String(S().shares[M().survivorId] || 0);

    /*
     * 只重算「还没结算」的人的意图（intents）。
     * 已结算的人手里股票早就扣掉了，再按当前持有数钳制会算出 0，
     * 界面就会显示成「置换 0」，而实际明明换过。
     *
     * results 是事实，这里一个字都不碰。
     */
    const pool = S().shares[M().survivorId] || 0;
    const intents = M().intents || {};
    const results = M().results || {};

    Object.keys(intents).forEach((k) => {
      const idx = Number(k);
      if (results[idx]) return;                     // 已结算，跳过

      const d = intents[k];
      if (!d) return;

      const have = S().players[idx].stocks[M().stockLoserId] || 0;
      d.swaps = Math.min(d.swaps || 0, Math.floor(have / 2), pool);
      d.keep = Math.min(d.keep || 0, have - d.swaps * 2);
    });
  }

  function humanStockRowHTML(h, p, sellPrice) {
    return `
        <div class="stock-row" data-p="${h.player}">
          <span class="stock-who" style="--p:${p.color}">${p.name}</span>
          <span class="stock-count">持有 ${h.count} 张</span>
          <span class="stock-split">
            <span class="split-item is-sell">
              <em>套现</em><b class="v-sell">${h.count}</b>
              <span class="split-gain">+$${(h.count * sellPrice).toLocaleString('en-US')}</span>
            </span>
            <span class="split-item">
              <em>置换</em>
              <button data-k="swap" data-d="-1">−</button><b class="v-swap">0</b><button data-k="swap" data-d="1">+</button>
            </span>
            <span class="split-item">
              <em>保留</em>
              <button data-k="keep" data-d="-1">−</button><b class="v-keep">0</b><button data-k="keep" data-d="1">+</button>
            </span>
          </span>
          ${deps.voteBtnHTML(h.player)}
        </div>`;
  }

  function idleStockRowHTML(pi) {
    const p = S().players[pi];
    return `
        <div class="stock-row is-empty" data-p="${pi}">
          <span class="stock-who" style="--p:${p.color}">${p.name}${deps.isHuman(pi) ? '' : '<em class="ai-tag">AI</em>'}</span>
          <span class="stock-count">持有 0 张</span>
          <span class="stock-split"><span class="split-text">没有这只股票</span></span>
          ${deps.voteBtnHTML(pi)}
        </div>`;
  }

  function stockStepperEnabled(d, count, survivorShares, isSwap, delta) {
    if (isSwap) {
      return delta > 0
        ? (d.swaps + 1) * 2 + d.keep <= count && d.swaps + 1 <= survivorShares
        : d.swaps > 0;
    }
    return delta > 0
      ? d.keep + 1 + d.swaps * 2 <= count
      : d.keep > 0;
  }

  function capStockDecision(d, count, survivorShares) {
    d.swaps = Math.max(0, Math.min(d.swaps, Math.floor(count / 2), survivorShares));
    d.keep = Math.max(0, Math.min(d.keep, count - d.swaps * 2));
  }

  function stockSellCount(h, d) {
    return h.count - d.swaps * 2 - d.keep;
  }

  function paintStockRow(row, h, d, sellPrice, survivorShares) {
    capStockDecision(d, h.count, survivorShares);
    const sell = stockSellCount(h, d);

    row.querySelector('.v-sell').textContent = String(sell);
    row.querySelector('.split-gain').textContent =
      sell > 0 ? '+$' + (sell * sellPrice).toLocaleString('en-US') : '—';
    row.querySelector('.split-gain').classList.toggle('is-muted', sell === 0);
    row.querySelector('.v-swap').textContent = String(d.swaps);
    row.querySelector('.v-keep').textContent = String(d.keep);

    row.querySelectorAll('button[data-k]').forEach((b) => {
      b.disabled = !stockStepperEnabled(
        d, h.count, survivorShares, b.dataset.k === 'swap', Number(b.dataset.d)
      );
    });
  }

  function onStockStepperClick(e, repaint) {
    const btn = e.target.closest('button[data-k]');
    if (!btn || btn.disabled) return;

    const row = btn.closest('.stock-row');
    if (!row) return;

    const idx = Number(row.dataset.p);
    const intent = M().intents && M().intents[idx];
    if (!intent) return;

    const delta = Number(btn.dataset.d);
    if (btn.dataset.k === 'swap') intent.swaps = Math.max(0, intent.swaps + delta);
    else intent.keep = Math.max(0, intent.keep + delta);

    repaint();
  }

  function applyAiStockChoice(idx, loserId, size) {
    if (deps.isHuman(idx)) return;

    const freshPool = S().shares[M().survivorId] || 0;
    const have = S().players[idx].stocks[loserId] || 0;

    const d = window.AcquireAI
      ? window.AcquireAI.pickStock(deps.aiContext(idx), {
        loserId: loserId,
        survivorId: M().survivorId,
        size: size,
        count: have,
        survivorShares: freshPool,
      })
      : { swaps: 0, rest: 'sell', keep: 0 };

    const sw = Math.min(d.swaps || 0, Math.floor(have / 2), freshPool);

    /*
     * AI 可以返回精确的「保留张数」（逐张 90% 判断会得到中间值），
     * 只给 rest 字符串时退回「全留或全卖」。
     */
    const keepCount = typeof d.keep === 'number'
      ? Math.max(0, Math.min(d.keep, have - sw * 2))
      : (d.rest === 'keep' ? Math.max(0, have - sw * 2) : 0);

    M().intents[idx] = {
      swaps: sw,
      keep: keepCount,
    };

    const row = document.querySelector('.stock-row[data-p="' + idx + '"]');
    if (row) row.classList.remove('is-thinking');
  }

  function stageStocks(loserId, size) {
    const holders = orderedHolders(loserId);      // 发起者先，顺时针

    /*
     * intents = 玩家「想怎么做」，会被剩余股票数重新钳制
     * results = 实际「已经做了什么」，一旦写入不再改
     * stockDone 这套补丁已经删掉：有没有 results 就是有没有结算
     */
    M().intents = Object.create(null);
    M().results = Object.create(null);
    M().stockLoserId = loserId;
    M().stockSize = size;
    M().stockTotals = { cash: 0, swap: 0 };

    if (!holders.length) {
      applyStocks(loserId, size);
      return;
    }

    const sellPrice = deps.priceOf(size, loserId);
    const survivorShares = S().shares[M().survivorId] || 0;

    // 人类默认「全部套现」；AI 先不填 —— 轮到它确认时才算
    holders.forEach((h) => {
      M().intents[h.player] = deps.isHuman(h.player)
        ? { swaps: 0, keep: 0 }
        : null;
    });

    // 复用模块级的同一套规则，避免两份实现走偏
    const cap = (h, d) => capStockDecision(d, h.count, survivorShares);

    const holderRowList = holders.map((h) => {
      const p = S().players[h.player];

      if (!deps.isHuman(h.player)) {
        // AI：结算过就用事实画，没结算就画占位（思考中）
        return deps.aiStockRowHTML(h, M().results[h.player] || null, sellPrice);
      }

      const intent = M().intents[h.player];
      cap(h, intent);
      return humanStockRowHTML(h, p, sellPrice);
    });

    // 按「发起者 → 顺时针」把每个玩家都排进去，不分持股与否
    const holderRowByPlayer = Object.create(null);
    holders.forEach((h, k) => {
      // rows 是 holders.map 拼出来的，顺序与 holders 一致，这里按人拆开
      holderRowByPlayer[h.player] = holderRowList[k];
    });

    const orderedRows = [];
    for (let i = 0; i < S().players.length; i++) {
      const idx = (S().current + i) % S().players.length;
      orderedRows.push(holderRowByPlayer[idx] || idleStockRowHTML(idx));
    }
    const allStockRows = orderedRows.join('');

    deps.mergeModal(
      '并购结算 · 股票处置',
      deps.stockGuideHTML(loserId, M().survivorId),
      `<div class="stock-list">${allStockRows}</div>
       ${deps.voteFooterHTML()}
       <p class="vote-hint">按顺时针顺序，轮到你时调整好配额再点确认。</p>`,
      []
    );

    // 股票处置必须按顺序：从并购发起者起顺时针
    deps.beginVote({
      ordered: true,
      startIdx: S().current,

      /*
       * AI 的处置方案只在「轮到它确认」的这一刻才计算。
       * 之前是界面一打开就全算好，等于 AI 提前行动了。
       */
      beforeConfirm: function (idx) {
        const h = holders.find((x) => x.player === idx);

        // 没有这只股票的玩家：确认就行，不涉及结算
        if (!h) return;

        // AI 到这一刻才决定，且必须基于最新的剩余股票数
        applyAiStockChoice(idx, loserId, size);

        // ★ 确认这一刻就真正结算，股票池立刻扣减
        settleStockPlayer(idx);

        // 按「结算结果」整行重画
        const row = document.querySelector('.stock-row[data-p="' + idx + '"]');
        const res = M().results[idx];

        if (row && res) {
          // 自检：套现 + 置换消耗 + 保留 必须等于他原本持有的张数
          const origin = res.sell + res.swaps * 2 + res.keep;
          if (origin !== h.count) {
            console.warn('[stock dispose] 显示与实际不符：原持有 ' + h.count
              + '，结算 ' + origin + '（套现 ' + res.sell + ' / 置换 ' + res.swaps + ' / 保留 ' + res.keep + '）');
          }

          // 用同一个渲染函数整行重画，保证和玩家行结构一致
          // 人类自己那一行不戴 AI 标
          row.outerHTML = deps.aiStockRowHTML(h, res, sellPrice, !deps.isHuman(h.player));
          deps.refreshVoteUI();
        }
      },

      onDone: function () {
        deps.releaseWatchdog();
        applyStocks(loserId, size);
      },
    });
    deps.holdWatchdog();

    const list = document.querySelector('.stock-list');
    if (!list) return;

    const repaint = () => {
      holders.forEach((h) => {
        if (!deps.isHuman(h.player)) return;          // AI 那几行是只读的
        const intent = M().intents && M().intents[h.player];
        if (!intent) return;
        const row = list.querySelector(`.stock-row[data-p="${h.player}"]`);
        if (!row) return;
        paintStockRow(row, h, intent, sellPrice, survivorShares);
      });
    };

    list.addEventListener('click', (e) => onStockStepperClick(e, repaint));

    repaint();
  }

  window.StockDisposal = {
    install: install,
    orderedHolders: orderedHolders,
    settleStockPlayer: settleStockPlayer,
    applyStocks: applyStocks,
    refreshPoolLabel: refreshPoolLabel,
    stageStocks: stageStocks,
  };
})();
