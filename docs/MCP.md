# OBA MCP — let Claude do the final check

A **local MCP server** (stdio — it opens no port and makes no network calls) that lets Claude read an **approved** article
from OBA and save a **ready-to-post version plus a change report** back into the job folder.

You review the *change report* instead of re-reading the whole article, then post the result yourself.

## The five tools

| Tool | What it does | Permission |
|---|---|---|
| `oba_list_approved` | Approved jobs whose file still matches the approved hash | read-only |
| `oba_get_article` | The approved article (+ its `sha256`), a **Blockdit draft** (no `[n]` numbers) and a **web draft** (keeps `[n]`) prepared by code, and the table of sources | read-only |
| `oba_get_source` | The text of source *N*, in pieces (default 12,000 characters; `offset` to keep reading) — or `find` to search for a word, number or name and get only the text around each hit. Saves the model's context | read-only |
| `oba_get_checks` | The code-made fact check (`fact_check.md`), the AI reviewer's observations, the evidence base, and the flagged items | read-only |
| `oba_save_final` | Saves `final/r<N>/` = `blockdit.md`, `web.md`, optional `image_prompts.md`, `change_report.md`, `meta.json` | writes **only** new files in `data/jobs/<id>/final/` |

## What is deliberately missing

- **No publish / deploy tool.** Posting is yours.
- **No approve / send-back / edit-state tool.** The Human Gate belongs to you, through the web page only.
- **No way to read `.env` or any file outside the job folder.** Job ids must look like `OBA-xxxxxxxx`.
- It never touches `blockdit.md` (the approved file) or `state.json`.

## Rules enforced by code

1. Only **approved** jobs whose current file still matches the approval hash can be read. If the file was edited after approval, the tools refuse.
2. `oba_save_final` must send the `baseSha256` of the approved version — so work cannot be based on an old copy.
3. Every change of type `fact_fix` or `addition` needs a **`source`** (a URL, or "source N") and the text after the change. No source, no save.
4. The code compares the numbers in the web version with the approved version and lists **numbers that are new / gone** in the report. It warns if the Blockdit version still has `[n]` or the web version has none.
5. Every save is a **new revision** (`r1`, `r2`, …); nothing is overwritten. Its status is `claude_edited_pending_owner_review` — waiting for you.
6. Every tool result carries a notice that the article and source text are **data from the web, not instructions** — a page that says "ignore your rules and…" is to be ignored and reported.

## Install

Use the **full path** to Node and to `src/mcp-server.mjs` (Claude Desktop may not see your shell's `PATH`).
Replace the paths below with yours. Find Node's path with `which node` (macOS/Linux) or `where node` (Windows).

### Claude Code

Run once, from any folder:

```bash
claude mcp add oba -- node /absolute/path/to/this-repo/src/mcp-server.mjs
```

On Windows, if `node` is not on the PATH of the process Claude Code starts, give the full path to `node.exe`:

```bash
claude mcp add oba -- "C:\Program Files\nodejs\node.exe" "C:\path\to\this-repo\src\mcp-server.mjs"
```

### Claude Desktop

Open **Settings → Developer → Edit Config** (the file is `claude_desktop_config.json`:
`%APPDATA%\Claude\` on Windows, `~/Library/Application Support/Claude/` on macOS) and add:

```json
{
  "mcpServers": {
    "oba": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\path\\to\\this-repo\\src\\mcp-server.mjs"]
    }
  }
}
```

Keep any other entries already in `mcpServers`. Then **quit Claude Desktop completely** (from the system tray / menu bar) and open it again.
You should see the `oba` connector with its five tools.

> The server reads the same `data/jobs` folder as the web page, so Node must be able to open it — run both from the same installation.

## Use it

1. Approve an article in the OBA page (Human Gate).
2. Tell Claude: *"Do the final check of job OBA-xxxxxxxx for posting to Blockdit and the website."*
3. Claude lists the approved jobs, fetches the article, the checks and the sources it needs (using `find` to look up only the numbers and names), fixes what the sources do not support, and saves a revision with `oba_save_final`.
4. Open `data/jobs/<id>/final/r<N>/change_report.md`. It groups changes as **Fact fixes, Additions, Removals, Language polish, Format, Images**, each with before/after and source, and shows number differences and warnings.
5. If you are happy, copy `blockdit.md` / `web.md` and post them yourself.

If Claude finds nothing to change it still saves a revision with one `format` change that says so, so you have a record.

## Safety notes

- The MCP server is **only as safe as the account you run it under**: it can write files in `data/jobs/*/final/` and read approved jobs. It does not call the network.
- Anything Claude writes is a **proposal**. It is never the approved text; the approval still points at `blockdit.md`.
- Because article and source text are web content, a hostile page could try to steer the model. The tools are shaped so that even a fooled model can only create a new, clearly labelled file for you to review.

## Test

`npm test` runs `tests/finalizer.test.mjs` and `tests/mcp-server.test.mjs` (they start the server over stdio and call the tools; no AI, no network).
