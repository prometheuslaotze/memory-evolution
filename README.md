# 🧠 Memory Evolution (Beta)

![Memory Evolution Landing Illustration](./assets/landing-illustration.jpg)

**Language / 语言**: [English](#english) | [中文](#中文)

---

## English

> Most AI systems accumulate memory. This one fights accumulation.

⚠️ **Requires EvoMap Evolver runtime**  
⚠️ **Must be managed by systemd**  
⚠️ **Automatically deletes memory entries**

Memory Evolution is a deterministic self-pruning memory optimization module for long-running AI agents.

It continuously optimizes `memory.md` by removing:
- Redundant entries
- Zero-information iterations
- High-frequency duplicates

It does **not** use embeddings, semantic models, or summarization.

An agent should not become smarter by remembering more.  
It should become smarter by forgetting what adds no value.

### What this is

- Deterministic memory pruning system
- Runs on top of **EvoMap Evolver**
- Designed for long-running autonomous agents

### What this is NOT

- Not a semantic summarizer
- Not an embedding-based optimizer
- Not a cognition/LLM reasoning system

### Prerequisite (Required)

Install EvoMap Evolver first:

👉 https://github.com/EvoMap/evolver

Follow EvoMap's installation instructions before using this project.

### Installation

```bash
git clone https://github.com/prometheuslaotze/memory-evolution.git
cd memory-evolution
```

This repository is a memory module. Runtime loop execution is managed by the Evolver host.

### Runtime Model

Memory Evolution should run only under a single systemd-managed loop (through Evolver runtime).

**Do not run manual loop processes in production alongside systemd.**

Otherwise you may hit:
- Singleton lock conflicts
- Restart loops
- Multi-instance race conditions

### Recommended systemd (user service)

Use user-level systemd (recommended for workstation deployments):

`~/.config/systemd/user/memory-evolution.service`

```ini
[Unit]
Description=Memory Evolution Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/evolver
ExecStart=/usr/bin/env node index.js --loop
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Apply:

```bash
systemctl --user daemon-reload
systemctl --user enable --now memory-evolution.service
systemctl --user status memory-evolution.service
```

### Singleton Behavior

Single-instance execution is enforced.
If another instance is running, a new instance exits safely by design.

### Beta Warning

This software actively deletes memory entries.

Use in staging first, and always back up `memory.md` before aggressive tuning.

### Designed for

- Persistent agent frameworks
- Long-running autonomous systems
- Experimental AI infrastructure builders
- Developers exploring memory lifecycle optimization

---

## 中文

> 大多数 AI 系统不断累积记忆。这个系统专门对抗累积。

⚠️ **必须依赖 EvoMap Evolver 运行时**  
⚠️ **必须由 systemd 托管运行**  
⚠️ **会自动删除 memory 条目**

Memory Evolution 是一个面向长时运行 Agent 的、**确定性**记忆裁剪模块。

它会持续优化 `memory.md`，删除：
- 重复条目
- 零信息增量迭代
- 高频同类重复写入

它**不使用** embedding、语义模型或总结器。

Agent 不该因为记住更多而变聪明。  
它应该因为忘掉无价值内容而变聪明。

### 这是什么

- 一个确定性记忆裁剪系统
- 运行在 **EvoMap Evolver** 之上
- 面向长期自治运行的 Agent

### 这不是什么

- 不是语义总结器
- 不是 embedding 优化器
- 不是认知/推理系统

### 前置依赖（必须）

请先安装 EvoMap Evolver：

👉 https://github.com/EvoMap/evolver

使用本项目前，先完成 Evolver 官方安装步骤。

### 安装

```bash
git clone https://github.com/prometheuslaotze/memory-evolution.git
cd memory-evolution
```

本仓库是 memory 模块；循环运行由 Evolver 主运行时托管。

### 运行模型

Memory Evolution 只能在**单一 systemd 托管循环**下运行（通过 Evolver runtime）。

**生产环境不要手动跑 loop 并与 systemd 并行。**

否则会出现：
- 单例锁冲突
- 重启循环
- 多实例竞争

### 推荐 systemd 方案（用户级）

推荐使用用户级 systemd（工作站场景）：

`~/.config/systemd/user/memory-evolution.service`

```ini
[Unit]
Description=Memory Evolution Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/evolver
ExecStart=/usr/bin/env node index.js --loop
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

应用：

```bash
systemctl --user daemon-reload
systemctl --user enable --now memory-evolution.service
systemctl --user status memory-evolution.service
```

### 单例行为

系统强制单实例运行。  
若检测到已有实例，新实例会安全退出（设计如此）。

### Beta 警告

该软件会主动删除 memory 条目。

请先在 staging 环境验证，并在激进策略前备份 `memory.md`。

### 适用对象

- 持久化 Agent 框架
- 长时自治系统
- 实验型 AI 基础设施开发者
- 关注 memory 生命周期优化的工程团队
