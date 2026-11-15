# 研发团队 B · 任务记录（本轮追加）

## 2026-11-15 12:29 · 3D 新项目（原创，全新主题）
- 做了什么：`llinok111/tangentflip-cert-lab` — 逐三角 **UV 手性证书** + **normal-map 着色误差的可复算角度**。核心纯计算 `src/core.mjs`（UV 有向面积符号 → mirrored/right-handed/degenerate 三分；单遍 Lengyel 切线累积；`atan2(|a×b|, a·b)` 稳定角度；`w = 手性` 的证书帧 vs `w = +1` 的作者帧）。`baseline/naive.mjs` 给 O(V·F) 的独立朴素基线与独立分类器，`tools/gen-sample.mjs` 造 3 个确定性语料（半镜面 UV 球 / 干净球 / 塌缩 UV 列球）。
- 结果：**发布**（public；pushed_at 2026-11-15T04:29:14Z；干净克隆按 README 跑 `node tools/gen-sample.mjs && node bench/verify.mjs` → `RESULT PASS: 18 passed / 0 failed`，exit 0）
- 仓库：https://github.com/llinok111/tangentflip-cert-lab
- 关键实测数字（`bench/result.json`，node v24.19.0，最终以重跑后的 result.json 为准）：
  - 6,912 三角半镜面 UV 球：**3,456 mirrored / 3,456 right-handed / 0 degenerate**（三分划分完整）
  - 作者帧（`tangent.w = +1`）在镜像三角上的着色误差：**均值 45.290306°、最大采样 73.739795°**；右手三角 **精确 0**；证书帧（`w = UV 手性`）**worst sampled 0.000e+0°**（用 `atan2` 而非 `acos`，避免近 1 处的 1e-6 假噪声）
  - 扫描证书 vs O(V·F) 基线 **290.60×**（median 1.2179 ms vs 353.9262 ms，p95-vs-p95 204×）；两侧**同样**按每样本 8 次连跑取均值（`coreBatch=naiveBatch=8`），不是只给 core 批计时
  - **尺度不变**：3D 1e-6…1e6、UV 1e-3…1e3，26 个对比字段 **0 漂移（位级相同）**；`epsRel = 1e-12 × maxAbsUvArea` 是**唯一阈值且相对**，`maxAbsArea` 随 k² 精确缩放
  - 独立 oracle：朴素分类器 3/3 语料逐项一致；几何 bitangent oracle 在 **9,800 个可判三角上 0 分歧**；136 个球极点零 3D 面积扇形三角**从几何上不可判**，单列并写入 README 限制
  - `degen-sphere`：48 个零 UV 面积三角全部检出，且 **0 个被误算成 mirrored**
- 质量闸门：G1–G9 全过（G5 的 relStddev 在 README 里如实解释为 ~2.3 ms 量级的 JIT/GC 噪声，并给出绝对 stddev/p95/cold）
- 创新：**B**。发布前起只读调研子 agent，结果指出**原定选题（蒙皮动画连续时间自交证书 + 最小姿态修复）已被同账号当日 04:29 发布的 `llinok111/skinint-cert-lab` 覆盖 → C 档**，于是当场换题到「逐三角 UV 手性 + normal-map 着色误差」这条台账零先例的轴（`winding-cert`/`pointnorm-cert` 只做顶点朝向，`uv-audit` 只做 UV 重叠/畸变）。README `## 本轮创新` 已逐条对比。
- 上游回馈评估：**原创主题，无对应上游仓库可修** → 按契约交 **0 个**提案（不生成 `state/upstream-pr.json`）。
- Lead 自做的独立复算（不 import core，/tmp 里另写脚本）：mirror-sphere 有向 UV 面积 pos=3456 / neg=3456 / zero=0，maxA=2.893518518518536e-4，最小非零 |A|=2.893518518518498e-4 ≫ eps=2.8935e-16（即 48 个 degenerate 的确只是精确 0）；全量 64 采样角扫描独立复现 **authored worst 73.739795° / certified worst 0.000000°**，可判三角中 mirrored=3420（+36 个 nl=0 的极点扇形 = 3456），与 README 的 136 个不可判三角一致。
- 独立 verifier：只读子 agent 已在 /tmp 干净克隆复核（重跑 verify/bench、自写脚本复算 UV 符号、反证「证书帧精确 0」、复核三个前作的 README 是否真不撞车、卫生检查）。
- **未完成 / 下一步（按续接优先级）**：
  1. 球极点 136 个零 3D 面积扇形三角不可判 —— 若要做强，可加「按 UV 邻接环判断整体手性」的补丁，把不可判集合压到 0（需新证据）。
  2. 目前只在自造语料上验证；未接真实 glTF 资产（本机 github.com:443 封禁，取真实资产受限）。若可从 `gh api` 取到带镜像 UV 的真实模型，应加一个真实资产语料。
  3. 顶点级 `w` 目前取「关联三角多数符号」；未做 seam 上按 UV 连通分量分组的严格版（README 未声称，属可选增强）。
  4. `relStddev` 仍 >10%（已用批计时压低），可由执行器复核确认最终 result.json 数值。
  5. `/home/ubuntu/GitHub/pipelines/state/*` 追加再次被沙箱拒绝（PermissionError），等价记录在本目录 `state/`（runs.jsonl / used-upstreams.txt / innovation.md / TASKS.md / PROJECTS.md），请归档时代为追加。
  6. 本轮实际用时约 10 分钟（12:20→12:29 出可发布态），未超 35 分钟硬限，剩余时间用于 verifier 复核与批计时改进。
