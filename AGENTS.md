# TOP RULES

- 测试测行为不测实现：不会红的测试是负资产，要跟着重构改的测试也是。每个测试写完过「两问检验」（docs/testing.md），交付必附红灯证据。
- 问题当场清，不留「下次」。
- 改动一律走 PR，rebase-only，不 push 主干；提交全部 `git commit -s`（DCO）。
- 决策与验收记录只存对应 issue / PR，仓库不落过程性文档；仓库只存几乎固定、不会更改的文档。
- 数值改动必须回写数据表（`src/data/`）并让设计文档/开发计划升版；只改代码不改文档的 PR 打回。
- UI 改动必须附真浏览器渲染取证（截图落 PR，注明日期 + commit 基线）。测试绿 ≠ 渲染活：curl 200、单测全绿都不算通过。
- 玩法代码只认资产 id，路径只出现在 `src/assets/manifest.ts`；文案与资产引用一律走 `t()` / `f()` / `assetId()`，不写死后缀。
- 一文件一职责，归不清先拆。

## 会话循环

一个 issue 一个分支，做完即退。

1. 认领一个 issue（当前最小编号、依赖满足）。
2. `git fetch origin && git switch -c issue-<N> origin/main`
3. 依据：玩法看 docs/揭阳陶塑数字体验游戏_设计文档.md，进度看 docs/揭阳陶塑数字体验游戏_开发计划.md，测试标准看 docs/testing.md。
4. 动手前过「开工前边界自查」（docs/testing.md，5+3 项），答案写进 issue 或 PR。
5. 验证：跑「四段门禁」（docs/testing.md「门禁」，CI 与本地同一套，缺一不可）。
6. `git commit -s` 小步提交 → `gh pr create`（用 PR 模板：中文 + `closes #N` + 验收对照）。
7. 五关验收（docs/testing.md「五关验收」）通过后 rebase 合并，删分支。

## 文档地图

| 文档 | 定位 |
|---|---|
| docs/揭阳陶塑数字体验游戏_设计文档.md | 玩法真相：工艺流程、随机系统、失败惩罚、验收清单 |
| docs/揭阳陶塑数字体验游戏_开发计划.md | 进度真相：环节拆分、当前状态、资产替换约定 |
| docs/testing.md | 测试与验收真相：测试标准、门禁、边界自查 |

决策与验收记录不设文档，只存对应 issue 与 PR。`docs/` 下不得出现决策档案、验收/审计记录类文件。

## 已知坑索引（一行一条，细节见指向处）

- 本地残留 `dist/` 会让 typecheck/build 显示假绿——验收以 CI（干净树）为准。
- 测试绿 ≠ 渲染活：WebGL 初始化失败、静态资产 content-type 错这类问题只有真浏览器走查能发现，见 TOP RULES 的取证要求。
