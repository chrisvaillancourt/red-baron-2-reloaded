# omp integrations

Read this reference before using `claude_task` from omp. Native Claude Code sessions and
native isolated subagents follow [the harness reference](HARNESSES.md) instead.

## Claude bridge

- `claude_task` starts Claude in the invoking session's working directory; it does not create
  a worktree or expose a per-call working-directory override. Before bridge-driven
  implementation, create a dedicated workspace and invoke the bridge from an omp session
  rooted there (or use its standalone CLI with that working directory). Merely naming a
  worktree in the prompt does not relocate the process.
- Apply [Base commit verification](HARNESSES.md#base-commit-verification) before implementation.
  Read-only consultation may use the main checkout.
- The restricted consultation bridge suppresses project instruction loading; it is not a
  context-discovery check. Use fresh project-enabled harness sessions for that verification.
