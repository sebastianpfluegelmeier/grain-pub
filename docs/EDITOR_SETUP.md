# Editor Setup

## Helix

The Grain LSP gives you on-the-fly diagnostics: parse errors, undefined names,
unknown builtins (with "did you mean?" hints), arity mismatches, named-arg
typos. Errors are positioned on the line of the offending statement.

### 1. Install the language server (`grain-lsp`)

Build and install the binary:

```bash
cargo build --release -p grain-lsp
mkdir -p ~/.local/bin
cp target/release/grain-lsp ~/.local/bin/grain-lsp
```

Make sure `~/.local/bin` is on your `$PATH` (`which grain-lsp` should print
the path).

### 2. Wire it up in Helix

Add to `~/.config/helix/languages.toml` (create it if it doesn't exist):

```toml
[language-server.grain-lsp]
command = "grain-lsp"

[[language]]
name = "grain"
scope = "source.grain"
file-types = ["grain"]
language-servers = ["grain-lsp"]
comment-token = "//"
indent = { tab-width = 2, unit = "  " }
roots = []
```

Verify with `hx --health grain` — the language-server section should show
`grain-lsp` and a green checkmark.

When you change the compiler and want the LSP to pick up the new error
messages, rebuild and replace the binary:

```bash
cargo build --release -p grain-lsp && cp target/release/grain-lsp ~/.local/bin/grain-lsp
```

Restart Helix (or `:lsp-restart`) for the new binary to take effect.
