# 易记

[English documentation](./README.md)

“易记”是一个适配 Obsidian Mobile 的本地题库刷题插件。当前源码构建内置 1433 道电力交易员四级题目，不要求使用者复制 `Study_Vault`；答题进度、错题和收藏保存在使用者自己的 Obsidian 仓库中。

## iPhone / Android 安装

已进入 Obsidian 社区插件目录。在 Obsidian 中依次打开“设置 → 第三方插件
→ 浏览”，搜索“Yiji Study”并安装；已安装的用户可在第三方插件中检查更新。受社区目录当前仅允许 Basic Latin 名称的规则限制，
市场显示名为 “Yiji Study”，插件内仍使用中文产品名“易记”。

也可以继续使用 BRAT 安装。把下面的安装页直接发给同事：

<https://ziz-lg.github.io/yiji-study/>

安装过程：

1. 在 Obsidian 中允许社区插件，安装并启用 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)。
2. 回到安装页点击“在 Obsidian 中安装易记”，确认 BRAT 的安装提示。
3. 在“设置 → 第三方插件”中启用“Yiji Study”（应用内名称“易记”）。

已装好 BRAT 的设备可以直接打开：

<obsidian://brat?plugin=ZiZ-LG%2Fyiji-study&version=latest>

如果深链没有唤起 Obsidian，可在 BRAT 的 “Add a beta plugin” 中填写 `ZiZ-LG/yiji-study`。后续版本通过 GitHub Release 发布，由 BRAT 按其更新设置检查并安装。

## 当前能力

- 内置 1433 道题：单选 704、多选 351、判断 378。
- 按 22 个知识域及“未归类”分组，或三种题型开始刷题。
- 即时判题，并展示原答案和题目来源。
- 自动记录上次位置，再次打开可从断点继续。
- 答错自动进入错题本，之后完整答对自动移出；历史次数继续保留。
- 统计已答题目、累计作答、正确率、收藏和最近记录。
- 一级导航为“题库 / 模考 / 统计”，错题本位于统计之下。

模考新增 2026 年 6 月 26 日 A 卷、B 卷，6 月 30 日卷、7 月 18 日卷，各 170 题，可完整作答、保存断点、跳转答题卡、交卷计分和回顾答案。交卷后才更新答题统计与错题本，未答题计 0 分但不加入错题本。每卷保留最近一次作答快照，再练一次会明确提示替换；累计答题记录继续保留。

前三卷为 100 单选、30 多选、40 判断，逐题合计 100 分。7 月 18 日原卷为 100 单选、20 多选、50 判断，逐题合计 95 分，尽管卷头标注 100 分；易记保留原卷差异，按逐题分值计分，不折算。练习固定限时 120 分钟沿用易记设置，原 PDF 仅记载个人实际用时，不能据此确认官方限时。切到后台后计时继续，超时后回到试卷将自动交卷。

原有两套样卷和五套模拟卷仍待完成映射和体检，暂未开放；本次没有用随机题替换这些入口。

## 使用入口

启用插件后，通过 Obsidian 功能区的书本图标，或命令面板中的“易记：打开刷题器”进入。题库、模考、统计三个一级入口位于界面底部。

## 本地开发

要求 Node.js 20.19 或更高版本。

```bash
npm install
npm run verify
npm run install:local
```

本开发目录中的 Markdown 内容真源位于：

```text
Study_Vault/电力交易员StudyVault-题型版/
```

完整的 20 个旧题源文件存在时，开发版解析 Markdown 并合并内置新增题，避免旧仓库遮蔽新增试卷。其他仓库自动使用完整内置题包。重新生成题包需提供旧题源、新增目录中的 11 个测验 Markdown 和四份原始 PDF，并安装 Poppler 的 `pdftotext`。执行 `npm run content:generate` 会核对 680 个原卷题号的题干、选项、答案及分值，校验合并题量、解析问题和稳定 ID。普通构建和测试无需 PDF。

常用命令：

```bash
npm run dev                     # 监听源码并增量构建 main.js
npm test                        # 解析器、内置题包、题库和学习状态测试
npm run check                   # TypeScript 检查
npm run lint:obsidian           # Obsidian 官方插件规范检查
npm run build                   # 生产构建
npm run check:ui                # 手机端字号、触控、导航和依赖契约扫描
npm run check:mobile-layout     # 手机端真实布局测量
npm run verify                  # 完整开发验证
npm run check:exam-ui           # 真实界面四套卷作答与窄屏回归
npm run verify:release -- 0.1.7 # 生成校验和并验证 Release 契约
```

推送与 `manifest.json` 版本完全一致的 Git 标签后，GitHub Actions 会验证并发布 BRAT 所需的 `main.js`、`manifest.json`、`styles.css` 和 `SHA256SUMS.txt`。

## 数据与公开边界

- 插件运行时没有网络请求、账号系统或云端数据库。
- 学习进度由 Obsidian 的插件数据接口保存在个人仓库，不会提交到本项目。
- 公开仓库包含插件源码和已授权公开的结构化题包。
- 原始 `Study_Vault`、真题 PDF、本机 `.obsidian` 配置和内部产品文档不进入公开仓库。

插件结构和发布文件约定参考 [Obsidian 官方示例插件](https://github.com/obsidianmd/obsidian-sample-plugin)。

## 许可

- 插件代码采用 MIT License。
- 内置结构化题库采用 CC BY-NC-ND 4.0，仅允许在遵守署名、非商业使用和禁止传播演绎版本等条款的前提下复制与原样分享。
- 题目中标注的第三方来源及材料，其权利仍归相应权利人所有。

完整的双许可范围见 [LICENSES.md](./LICENSES.md)：插件代码使用
[MIT License](./LICENSE)，内置题库内容使用
[CC BY-NC-ND 4.0](./LICENSE-CONTENT.md)。
