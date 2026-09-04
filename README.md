# 易记

“易记”是一个适配 Obsidian Mobile 的本地题库刷题插件。发布包已经内置 1085 道电力交易员四级题目，不要求使用者复制 `Study_Vault`；答题进度、错题和收藏保存在使用者自己的 Obsidian 仓库中。

## iPhone / Android 安装

推荐把安装页直接发给同事：

<https://ziz-lg.github.io/yiji-study/>

安装过程：

1. 在 Obsidian 中允许社区插件，安装并启用 [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)。
2. 回到安装页点击“在 Obsidian 中安装易记”，确认 BRAT 的安装提示。
3. 在“设置 → 第三方插件”中启用“易记”。

已装好 BRAT 的设备可以直接打开：

<obsidian://brat?plugin=ZiZ-LG%2Fyiji-study&version=latest>

如果深链没有唤起 Obsidian，可在 BRAT 的 “Add a beta plugin” 中填写 `ZiZ-LG/yiji-study`。后续版本通过 GitHub Release 发布，由 BRAT 按其更新设置检查并安装。

## 当前能力

- 内置 1085 道题：单选 503、多选 277、判断 305。
- 按 22 个知识域或三种题型开始刷题。
- 即时判题，并展示原答案和题目来源。
- 自动记录上次位置，再次打开可从断点继续。
- 答错自动进入错题本，之后完整答对自动移出；历史次数继续保留。
- 统计已答题目、累计作答、正确率、收藏和最近记录。
- 一级导航为“题库 / 模考 / 统计”，错题本位于统计之下。

模考页已经固定呈现两套参考原卷和五套模拟卷的入口，但“开始考试”暂未开放。两套原卷仍需完成逐题映射，五套模拟卷也需完成重复题、答案完整性和题型配比校验；在这些工作完成前，插件不会用临时随机抽题冒充固定试卷。

## 使用入口

启用插件后，通过 Obsidian 功能区的书本图标，或命令面板中的“易记：打开易记”进入。题库、模考、统计三个一级入口位于界面底部。

## 本地开发

要求 Node.js 18 或更高版本。

```bash
npm install
npm run verify
npm run install:local
```

本开发目录中的 Markdown 内容真源位于：

```text
Study_Vault/电力交易员StudyVault-题型版/
```

完整的 20 个题源文件存在时，开发版优先解析 Markdown；普通使用者的仓库中没有这些文件时，插件自动使用内置题包。题源变化后执行 `npm run content:generate`，生成器会校验题量、解析问题、稳定 ID 冲突和题源摘要。

常用命令：

```bash
npm run dev                     # 监听源码并增量构建 main.js
npm test                        # 解析器、内置题包、题库和学习状态测试
npm run check                   # TypeScript 检查
npm run build                   # 生产构建
npm run check:ui                # 手机端字号、触控、导航和依赖契约扫描
npm run verify                  # 完整开发验证
npm run verify:release -- 0.1.0 # 生成校验和并验证 Release 契约
```

推送与 `manifest.json` 版本完全一致的 Git 标签后，GitHub Actions 会验证并发布 BRAT 所需的 `main.js`、`manifest.json`、`styles.css` 和 `SHA256SUMS.txt`。

## 数据与公开边界

- 插件运行时没有网络请求、账号系统或云端数据库。
- 学习进度由 Obsidian 的插件数据接口保存在个人仓库，不会提交到本项目。
- 公开仓库包含插件源码和已授权公开的结构化题包。
- 原始 `Study_Vault`、真题 PDF、本机 `.obsidian` 配置和内部产品文档不进入公开仓库。

插件结构和发布文件约定参考 [Obsidian 官方示例插件](https://github.com/obsidianmd/obsidian-sample-plugin)。
