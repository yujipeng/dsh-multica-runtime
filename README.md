# Multica DSH Runtime

Private, out-of-tree runtime bridge between Multica and the public
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It exposes
a versioned JSONL protocol over stdio and composes over
`@deepseek-ai/dsh-base`. It does not require changes to DeepSeek Harness.

![DeepSeek Harness runtime online in Multica](docs/images/multica-dsh-runtime.png)

## Privacy

- This repository contains only the Multica integration layer. It does not
  vendor or redistribute DeepSeek Harness source code.
- Never commit API keys, MCP secrets, session logs, or generated profiles.
- DSH telemetry is disabled by the bundle patch.
- stdout is protocol-only; diagnostics go to stderr.

## Local development

For a complete Linux/macOS installation walkthrough, see the
[Linux/macOS installation guide](docs/install-agent-runtime.md).

The DSH packages used by this plugin are public npm packages. This checkout is
currently validated against `@deepseek-ai/dsh@0.1.5-alpha.2` and its matching
`@deepseek-ai/dsh-*` package family.

```bash
pnpm install
pnpm check
pnpm build
```

Install the local bundle into a DSH profile after building it:

```bash
dsh plugin --profile multica add /absolute/path/to/multica-dsh-runtime
```

The plugin supports:

```bash
dsh --profile multica --probe
dsh --profile multica --list-models
dsh --profile multica --stdio
```

Multica discovers the profile only after `--probe` returns protocol version 1.
For a non-standard DSH installation, point the daemon at its launcher:

```bash
export MULTICA_DSH_PATH=/absolute/path/to/dsh
```

The runtime contract includes:

- model and thinking-level discovery from DSH itself;
- committed text, reasoning, tool, result, and token-usage events;
- cooperative cancellation and durable session resume;
- canonical Multica MCP configuration translated to DSH stdio or
  streamable-HTTP clients;
- per-runtime/agent session roots supplied by the Multica daemon;
- headless one-shot approvals, with no interactive question surface.
- narrowly forwards only Multica's server-minted `mat_` task token — plus any
  variable names an agent explicitly lists in `MULTICA_FORWARD_ENV` — into
  DSH's otherwise credential-scrubbed shell, so in-task `multica` commands
  retain task attribution and explicitly-authorized agent credentials (such as
  a third-party skill's `WEKNORA_API_KEY`) reach the shell without exposing
  model-provider credentials.

## Forwarding agent credentials to the shell

DSH scrubs any ambient environment variable whose name contains `KEY`,
`PASSWORD`, `SECRET`, or `TOKEN` from agent-spawned subprocesses. A
credential-shaped variable configured on a Multica agent — for example a
third-party skill's `WEKNORA_API_KEY` — therefore never reaches the shell by
default.

To forward such variables, add an agent environment variable listing their
names, comma-separated:

```bash
MULTICA_FORWARD_ENV=WEKNORA_API_KEY
```

Entries are trimmed and deduplicated. List only the credential-shaped names the
agent actually needs:

- names without a sensitive token (`WEKNORA_BASE_URL`, `PATH`, ...) already
  pass through — no need to list them;
- model-provider credentials (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, ...) must
  never be listed, or they would leak into the agent's shell.

The local `.local/` tree is ignored. It may hold an isolated DSH home and a
development launcher, but neither belongs in source control.

`DEEPSEEK_API_KEY` is read by DSH's credential provider at process runtime. It
must not be stored in this repository.
