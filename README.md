# 🧠 Memory Evolution (Beta)

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

---

## What this is

- Deterministic memory pruning system
- Runs on top of **EvoMap Evolver**
- Designed for long-running autonomous agents

## What this is NOT

- Not a semantic summarizer
- Not an embedding-based optimizer
- Not a cognition/LLM reasoning system

---

## Prerequisite (Required)

Install EvoMap Evolver first:

👉 https://github.com/EvoMap/evolver

Follow EvoMap's installation instructions before using this project.

---

## Installation

```bash
git clone https://github.com/prometheuslaotze/memory-evolution.git
cd memory-evolution
```

This repository is a memory module. Runtime loop execution is managed by the Evolver host.

---

## Runtime Model

Memory Evolution should run only under a single systemd-managed loop (through Evolver runtime).

**Do not run manual loop processes in production alongside systemd.**

Otherwise you may hit:
- Singleton lock conflicts
- Restart loops
- Multi-instance race conditions

---

## Recommended systemd (user service)

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

---

## Singleton Behavior

Single-instance execution is enforced.
If another instance is running, a new instance exits safely by design.

---

## Beta Warning

This software actively deletes memory entries.

Use in staging first, and always back up `memory.md` before aggressive tuning.

---

## Designed for

- Persistent agent frameworks
- Long-running autonomous systems
- Experimental AI infrastructure builders
- Developers exploring memory lifecycle optimization
