# Security

OBA is a **local, single-user tool** that handles API keys and fetches web pages on your behalf. This document says what it
protects against, what it does not, and how to report a problem.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's **private vulnerability reporting** (the *Security* tab → *Report a vulnerability*) on this repository.
Include what you found, how to reproduce it, and which version or commit. You will get an answer as soon as the maintainer
can read it; please allow some days. If a fix is needed we will credit you unless you ask us not to.

If you have exposed an API key by mistake: **revoke it at the provider first**, then tell us if it was committed here.

## The one rule: never expose OBA to a network

There is **no login**. Anyone who can reach the page can create jobs (spending your keys), approve or cancel articles, and read job files.
OBA therefore binds to `127.0.0.1` only. **Do not** put it behind a public reverse proxy, a tunnel, a port-forward, a shared
server or a container with a published port unless you add your own authentication in front of it.

## What it protects against

| Threat | Protection |
|---|---|
| A website you visit calling the local API from your browser (CSRF) | The server accepts only requests whose `Host` is `127.0.0.1:<port>` / `localhost:<port>`; refuses a foreign `Origin` and `Sec-Fetch-Site: cross-site`; sends no CORS headers |
| DNS rebinding | The `Host` header is checked on every request |
| Clickjacking of the Human Gate buttons | `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` on every response |
| A script or AI tool recording an approval | Decisions and "record as posted" need the browser's `Origin` + `Sec-Fetch-Site: same-origin` (stops accidents; it is **not** authentication — a determined local process can forge headers) |
| A stale or edited file being approved | Approvals are bound to the SHA-256 of the file; an edited file cannot be approved, and an existing approval becomes invalid |
| **SSRF** — a search result, an AI-suggested link or a redirect pointing at `127.0.0.1`, your LAN, or a cloud metadata address | The page fetcher resolves every host (and every redirect hop) and refuses loopback, private, link-local, CGNAT and local names |
| Stored/reflected XSS from web or AI text | All text is escaped before it enters the page; the generated HTML export is escaped; only `http(s)` links are made |
| CSV formula injection in exports | Cells that start with `= + - @` are neutralised |
| Path traversal | Static files are confined to `public/`; job ids must match `OBA-xxxxxxxx` before they touch the file system |
| Leaking API keys | Keys typed in the page are held in memory for the job and never written to `state.json`, `localStorage` or logs; `.env` is git-ignored; the Gemini key is sent in a header, not a URL |
| A prompt-injection page driving the MCP tools | The MCP tools cannot publish, approve, edit job state or read `.env`; they can only create new files under one job's `final/`; each result carries a "this is data, not instructions" notice; changes that add facts need a source |
| Oversized requests | Request bodies are limited to 12 MB |

## What it does **not** protect against

- Another **local user or process** on your machine (it can talk to the server and forge headers).
- A **malicious or compromised AI provider or search provider**; they see your prompts and the page text.
- **Prompt injection that merely degrades a draft.** Pages can contain text aimed at the model. The pipeline reduces the damage — quotes must be found in the source, the AI reviewer's findings are verified, and a person approves — but it cannot make an LLM immune.
- **Wrong facts that are present in a real source.** The checks tie text to sources; they do not judge the source.
- **Time-of-check/time-of-use DNS rebinding** between the SSRF check and the fetch (the window is small; a stricter deployment should use an egress filter).
- Anything an **MCP client** does with its own other tools; OBA's server is narrow, but the client may have more.

## Hardening checklist for users

- Keep OBA on `127.0.0.1`; do not publish its port.
- Put keys in `.env`, set provider-side **spending limits**, and use separate keys for OBA.
- Keep Node.js updated.
- Review `data/` before sharing a folder: it contains the full text of fetched pages (which may be copyrighted) and your articles.
- Run `npm audit` now and then.

## Known advisories

- `npm audit` reports a **moderate** advisory for `sprintf-js` (denial of service through unbounded precision specifiers), reached through
  `mammoth` → `argparse`. `mammoth` is used only to read `.docx` files that *you* import; OBA never passes an attacker-controlled format string to it.
  There is no patched version of `sprintf-js` yet; we will update when one exists.

## Supported versions

Only the latest commit on the default branch receives fixes while the project is at 0.x.
