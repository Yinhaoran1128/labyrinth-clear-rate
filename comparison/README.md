# 迷宫双引擎对比测试

安装文件：[`../labyrinth-engine-comparison.user.js`](../labyrinth-engine-comparison.user.js)。

在 Tampermonkey 新建脚本，粘贴该文件内容并保存，或通过用户脚本管理器导入该文件。
刷新银河奶牛游戏页面，点击右下角「双引擎对比」。它可与原来的迷宫胜率计算器同时安装。

## 使用

- 展示全部 10 种迷宫怪物，可勾选部分怪物。
- 统一等级后点击「应用到全部怪物」，或修改每种怪物自己的等级（1～10000）。
- 模拟次数为 1～2000，沿用原脚本的 `120 秒 × 次数` 模拟游戏时间预算，并非严格的对局数。
- 默认按每种怪物的迷宫配装与原脚本的回退规则选择配装；也可统一指定一个游戏中的战斗配装。
- 默认保留原脚本的随机模式；勾选固定种子可以复现同一次测试。相同种子不意味着两套引擎结果必须相同。
- 点击「开始对比」。所有输入在开始时形成快照，两套引擎顺序运行，并轮换每个怪物的引擎运行顺序。
- 「停止」终止 Worker，保留已经完成的结果和停止前的计算耗时。可重新开始。
- 「导出 JSON」保存参数、配装输入、引擎版本/哈希、局数、失败类型及耗时。完成后修改下一轮参数不会改变上一轮导出。

## 耗时与结果口径

| 字段 | 含义 |
|---|---|
| 胜率 | 获胜数 / 原脚本口径的统计局数 |
| 预计通关 | 原脚本累计耗时 / 获胜数，零获胜为 ∞ |
| 每行计算耗时 | 实际墙钟时间，包含输入适配、Worker 通信、模拟与结果读取 |
| 每套引擎累计计算耗时 | 所有实际尝试的计算时间之和，包含失败或停止前消耗的时间 |
| 初始化耗时 | 解压代码、创建 Worker、加载数据和初始化 WASM，单独显示 |
| 整轮总耗时 | 从开始到结束或停止的墙钟时间，包含初始化、所有计算、界面更新和调度 |
| `simulatedSeconds` | 引擎内部推进的游戏时间，区别于电脑实际计算时间 |
| Rust `completeExpectedSecondsPerClear` | 所有已完成对局的实际累计时间 / 获胜数，作为补充诊断 |

为了满足原引擎与现有脚本一致的要求，表格的「预计通关」**保留 1.5.14 原公式**，
包括其优先采用最后一次获胜时间、漏算此后已完成失败对局时间的行为。
原脚本还可能同时计入获胜和玩家死亡（例如反伤造成同归于尽）；Rust 的表格统计复用这个分母口径，
`completedTrials` 则另外保留真实已完成对局数。

零获胜样本只能说明本轮没有观察到获胜，并非数学上证明胜率为零。
不同电脑、浏览器、冷启动/JIT、后台负载及样本参数会影响实际计算耗时。
测试速度时，暂停原脚本自身的计算任务，避免同一时间的其他模拟干扰。

## 原引擎一致性

- 原脚本版本：Greasy Fork 566829，1.5.14，源码保持不变。
- 原源码 SHA-256：`aa4ffc048f53e7d628a52b8ccfe7c633979580fdaaf5df3a8102818be02d1da2`。
- 复用原文件的配装/DTO 构建函数、Worker 生成函数和 `computeCombatRoomClearChanceFullFlow`，不重写原胜率与耗时公式。
- 原引擎两个远程代码块固定为 2026-10-02 下载的快照，内嵌进安装文件。
- 默认使用原来的 `Math.random()`；固定种子模式只替换随机数来源，不修改战斗规则。
- 一致性保证针对固定的 1.5.14 源码与上述引擎快照。今后远程引擎被上游更新时，安装中的老脚本若加载了新代码，会与这个固定基准不同。
- 独立 Chrome 回归测试直接运行原文件中的函数，与对比脚本的原引擎比较：十种怪物、相同输入和随机序列下，胜率、预计耗时、局数、胜利/死亡/超时计数与累计游戏耗时逐项相同，包含有限预计耗时和零获胜场景。

## Rust/WASM 适配

上游：[wow121/mwi-fastsim](https://github.com/wow121/mwi-fastsim)，
固定来源提交：`115f48d94b5c230a5bb0d5f84110bb503a29ecd4`（2026-09-29）。

本工具对其引擎做以下适配：

1. 将迷宫的五种升级等级转换为永久增益。
2. 增加迷宫固定半冷却选项，匹配原脚本怪物初始技能冷却补丁；其他战斗模式保持上游规则。
3. 增加完整对局数、胜利/死亡/超时和已完成对局累计耗时统计。
4. Rust 使用原引擎快照内的物品、怪物、技能、强化、房屋等共同基础表，当前游戏客户端提供其余辅助表，减少数据版本差异的干扰。
5. 关闭详细攻击日志统计；两边均不使用食物、饮料或额外临时增益。
6. 在迷宫对比中启用 `labyrinthLegacyFury`：怒气命中加层、未命中减半时，用当前层数覆盖旧增益，匹配原引擎；其他模式及未启用选项时保留上游规则。

引擎和压缩代码都在生成的 `.user.js` 内，不需要额外的 WASM 文件或本地服务。
`@require` 的 LZString 与原脚本相同，用于读取压缩的游戏客户端数据。

## 开发和验证

```sh
cd comparison
npm ci
npm test
npm run build
npm run test:browser
```

0.1.1 修复了 0.1.0 中怒气枪配装胜率偏高的问题。上游的同名增益候选机制会保留较强旧值，导致怒气未命中减半后仍采用旧的命中/伤害加成。新增原生 Rust 层数回归与实际 WASM 胜率回归，保证修复包含在发布文件内。

可在本地重放导出的角色输入（固定种子 12345；不上传角色数据）：

```sh
node tests/replay-export.mjs /absolute/path/export.json tests/browser-results/replay.json
cd engine
cargo test --lib --locked
```

重放使用原引擎快照的共同基础表，辅助表使用测试目录中的公开游戏数据。导出文件未记录原始随机流，所以重放用于规则对照，不保证复现原导出中的随机计数。

浏览器回归测试默认使用 macOS 的 `/Applications/Google Chrome.app`，
创建隔离的浏览器会话与本地测试页面，不读取用户 Chrome 配置或真实角色资料。
测试数据来自上游公开的游戏数据，角色配装为合成的回归样本。
`tests/browser-results/` 保存测试截图与 JSON（已忽略）。

重新编译修改后的 Rust 引擎：

```sh
rustup target add wasm32-unknown-unknown
cd engine
cargo build --profile wasm --target wasm32-unknown-unknown --lib --locked
cd ..
cp engine/target/wasm32-unknown-unknown/wasm/mwi_engine.wasm assets/mwi_engine.wasm
npm test
npm run build
npm run test:browser
```

当前 WASM 使用 Rust 1.99.0 构建。构建器会检查原脚本哈希，原文件改变后须重新审查兼容性。
`assets/mwi_engine.wasm` 是已编译的适配版；`engine/src/` 保存其源码。

## 来源说明

原用户脚本作者 dakonglong，元数据声明 MIT。
JS 原战斗引擎来自 [shykai/MWICombatSimulatorTest](https://github.com/shykai/MWICombatSimulatorTest)。
Rust 核心及三个 JS 适配模块来自 wow121/mwi-fastsim；本地 `engine/src/` 和 `vendor/fastsim-js/` 保留上游源码及说明，
新工具只添加上述迷宫适配和对比界面。
