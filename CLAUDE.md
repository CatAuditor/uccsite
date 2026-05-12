# Vailo — Claude Code Guide

## After Every Task
At the end of every task, add a todo to update `/docs`:
- **`/docs/systems/`** — update or create a doc if you changed how something works (architecture, data flow, integrations, infrastructure)
- **`/docs/decisions/`** — add a decision record if a non-obvious choice was made (why this approach over alternatives)

Keep docs short. One file per system/decision. Filename should be kebab-case describing the subject.

## Behavioral Guidelines

### Think Before Coding
Surface assumptions and ambiguities before writing code. Never silently pick an approach when there are meaningful trade-offs — ask first.

### Simplicity First
No speculative features, no unnecessary abstractions. If code could be half as long without losing clarity, rewrite it.

### Surgical Changes
Only modify what was requested. No adjacent refactors, style cleanup, or "while I'm in here" changes.

### Goal-Driven Execution
Convert vague tasks into verifiable success criteria. Write a failing test, then make it pass. Define done before starting.
