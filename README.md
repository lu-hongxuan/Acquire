# Acquire · 60th Anniversary Edition

零依赖的《并购风云》浏览器版（ACQUIRE 60 周年纪念版）。纯 HTML / CSS / 原生 JS，双击 `index.html` 即玩，无需构建、无需服务器、无需联网。

A zero-dependency browser implementation of the classic board game **Acquire** (60th Anniversary Edition). Open `index.html` and play — no build step, no server, no network, no npm packages.

## 功能

- 完整规则引擎：回合三阶段（放置板块 → 购买股票 → 补充手牌）、并购结算（白板不计规模、名次按占位顺延、逐张处理股票）、终局结算
- 经典模式与大亨模式，分红金额严格对应实体「股东信息卡」
- 三档 AI 难度，覆盖出牌、买股、平局裁决、股票处置四条决策链
- 2–6 人本地热座，另有全 AI 观战模式
- 逐回合复盘帧、生涯数据与 30 项成就，全部保存在本地
- Web Audio 实时合成音效，无任何音频文件

## 怎么玩

1. 下载或克隆本仓库
2. 双击 `index.html`

界面为中文，规则全文见 [`规则书.md`](规则书.md)。

## 目录结构

```
index.html          游戏入口
css/                样式表
js/                 23 个模块，按顺序以普通 <script> 标签加载
tests/              Node 测试文件，无依赖
规则书.md            完整规则
sfx-tuner.html      独立的音效调校页
```

架构分层：纯规则引擎（`js/engine.js`，不碰 DOM）、只读数据层（`js/selectors.js`）、AI 决策层（`js/ai.js`）、表现层（`js/board.js` 及各 view 模块）。玩家与 AI 共用同一条代码路径，差别只在「谁触发」。

## 测试

```sh
node tests/engine.test.js
node tests/merger.test.js
node tests/selectors.test.js
```

## 许可

保留所有权利。本仓库仅供查看与个人试玩。
