# OBA User Guide

This is the full manual. If you only want to try it, the [README](../README.md) quick start is enough.
Everything below assumes you run OBA on your own computer, for yourself or a small editorial team.

**Contents**

1. [What you need](#1-what-you-need)
2. [Install](#2-install)
3. [Configure your keys (`.env`)](#3-configure-your-keys-env)
4. [Start and stop](#4-start-and-stop)
5. [Your first article](#5-your-first-article)
6. [What happens while it runs](#6-what-happens-while-it-runs)
7. [Reading the result](#7-reading-the-result)
8. [The Human Gate: approve, send back, cancel](#8-the-human-gate)
9. [Checking facts before you post](#9-checking-facts-before-you-post)
10. [Versions and what changed](#10-versions-and-what-changed)
11. [Posting your article](#11-posting-your-article)
12. [Final check with Claude (MCP)](#12-final-check-with-claude-mcp)
13. [Make it yours: rules, templates, voice](#13-make-it-yours-rules-templates-voice)
14. [Models, languages and cost](#14-models-languages-and-cost)
15. [Where your files are](#15-where-your-files-are)
16. [Troubleshooting](#16-troubleshooting)
17. [FAQ](#17-faq)
18. [Glossary](#18-glossary)
19. [Appendix A: a real weak run, and what it teaches](#19-appendix-a-a-real-weak-run-and-what-it-teaches)

---

## 1. What you need

| Need | Notes |
|---|---|
| A computer with **Node.js 22 or newer** | Check with `node --version`. Windows, macOS and Linux work. Get Node from <https://nodejs.org>. |
| An **AI provider key** | At least one of: DeepSeek (default), Anthropic, OpenAI, Google Gemini, OpenRouter. You pay the provider directly. |
| A **web-search key** *(treat it as required)* | Tavily, Serper or Brave. Without one OBA falls back to free Wikipedia and DuckDuckGo lookups; DuckDuckGo returns nothing to programs, so in practice **you get Wikipedia pages only** — often one relevant page, plus unrelated ones. We tested exactly this: see [Appendix A](#19-appendix-a-a-real-weak-run-and-what-it-teaches). Tavily has a free tier. |
| A modern browser | The interface is a local web page. |

You do **not** need a database, an account on any service run by this project, or a build step.

## 2. Install

```bash
git clone <this-repository-url>
cd <the-folder>
npm install
```

`npm install` downloads the few dependencies (MCP SDK, `exceljs`, `mammoth`, `pdfjs-dist`, `zod`).
Check that everything works without spending anything:

```bash
npm test
```

All tests should pass. They use no network and no key.

## 3. Configure your keys (`.env`)

Copy the example file and edit it:

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

`.env` is **git-ignored** — it never goes into version control. Put one key per line, no quotes:

| Variable | What it is for |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek (default provider) |
| `ANTHROPIC_API_KEY` | Claude models |
| `OPENAI_API_KEY` | OpenAI models |
| `GEMINI_API_KEY` | Google Gemini |
| `OPENROUTER_API_KEY` | OpenRouter |
| `TAVILY_API_KEY` | Web search + extracting pages that block direct fetching |
| `SERPER_API_KEY` | Google results (and the news tab for News analysis) |
| `BRAVE_API_KEY` | Brave Search |
| `GOOGLE_FACTCHECK_API_KEY` | *(optional)* used by the **Deep check** |
| `DEEPSEEK_MODEL` | *(optional)* override the DeepSeek model name |
| `PORT` | *(optional)* default `8080` |
| `PUBLICATION_NAME`, `SITE_URL` | *(optional)* used in the newsletter / caption / video-script drafts |
| `TARGET_ARTICLES` | *(optional)* the goal shown by the progress bar |

You can also type a key into the page for a single job (the **AI provider** card). It is sent only to your local server,
kept in memory while that job runs, and **never saved to disk or to the browser**. The `.env` file is the better habit.

> **Never** paste a key into an issue, a chat, a screenshot or a commit. If you do, revoke it at the provider and make a new one.

## 4. Start and stop

```bash
npm start
```

You should see `OnTheBridge OBA running at http://127.0.0.1:8080`. Open that address.
On Windows you can double-click `start.bat` instead. Stop with `Ctrl+C` (or close the window).

If port 8080 is busy, OBA tries 8081, 8082… and prints the one it chose. Or set `PORT` in `.env`.

The server listens **only on 127.0.0.1**: other devices on your network cannot reach it. Keep it that way
(see [SECURITY.md](../SECURITY.md)).

## 5. Your first article

Open the **Create article** tab. Fill in:

| Field | What to do |
|---|---|
| **Topic** *(required)* | A specific subject or question. The more concrete, the better the sources. *"Why did Amazon block shopping agents?"* beats *"AI and shopping"*. The system keeps the meaning you gave: it will not widen the topic or turn a question into a conclusion. |
| **Audience** | Used in the writing prompts. |
| **Article language** | English or Thai. Controls the writing language, the target length and the fixed words OBA adds (e.g. the footer). |
| **Article format (Template)** | *Let the AI choose* is fine to start. See the table below. |
| **Content Pillar** | A label that sets the writing approach (see `rules/`). Leave on *Let the AI choose*, or pick your own. |
| **Extra guidance** | Anything the writer must respect. **For an Opinion piece, your stance must be written here** — the system refuses to invent one. |
| **External links** | URLs you want read. They are opened first and never screened out as "off-topic". |
| **Interview / original text** | Paste a transcript you have already proofread. It becomes an evidence source; quotes are checked against it directly. |
| **AI provider / Model / API key / Search key** | See [section 14](#14-models-languages-and-cost). **Test the connection** checks the key with a tiny request. |

**Templates**

| Template | Use it for | Needs |
|---|---|---|
| Reflective | Life, philosophy, meaning: a thoughtful essay | If there is no real story, it reasons from evidence instead of inventing one |
| Explainer / How-to | Explain a concept or verified steps | It will not invent steps |
| Opinion / Column | Argue a position | **Your stance in the guidance box**, otherwise it falls back to Reflective |
| News analysis | A real event with several sides, told from published sources | Uses the news search when a Serper key is set |
| Feature / Narrative | A story about real people, places and quotes | Real data behind every character and quote; paste an interview if you have one |

**How to get a good result (read this once)**

1. **Have a search key** (section 1). The article can only be as good as the pages the system reads.
2. **Choose a topic that has several real, public sources** — an event with official documents and news reports, a study, a policy. A topic with one source produces a thin article.
3. **Give the system good links.** Paste the official page (a press release, a ruling, a report) into *External links*; it is always read first. For an interview, paste the transcript.
4. **Say what you want in the guidance box**, including the angle and anything to avoid.
5. **Match the topic to the template.** News analysis needs a real event; Feature/Narrative needs real people and quotes; Opinion needs *your* stance.
6. **Use a capable model** (section 14), and expect to read and decide — the system prepares a draft for a person, not a finished article.
7. **Mind the date.** The system does not know what day it is and sources often carry no date. For anything time-sensitive (an event that is about to happen, just happened, or changed), **check the tense and the status yourself.**

Press **Start the article**. A status line shows the job id. Runs usually take several minutes, depending on the model
and how many pages must be fetched. You can leave the page; the job continues on the server.
Open **All jobs** to see every job and its status.

## 6. What happens while it runs

You can open a job at any time to watch the eight stages turn green.

| Stage | What it does | If it goes wrong |
|---|---|---|
| **brief** | Chooses template and pillar (unless you chose), plans 3–4 search queries, picks "relevance terms" that a good page must contain | — |
| **research** | Searches, then **opens the real pages** (HTML and PDF). Skips social and video sites. Drops pages that do not mention the relevance terms. Retries blocked pages through Tavily Extract if you have a key | *"Research found no readable sources"* — check your search keys and the topic |
| **evidence** | The AI extracts up to 25 facts with quotes; **code checks every quote against the page text**. A fact that fails becomes `needs_verification` and is kept out | *"no fact passed the check"* → the job stops **before writing**, so an article never lacks evidence |
| **outline** | Assigns each verified fact to exactly one of four slots and names the sections | — |
| **write** | Writes the four slots one at a time, each with its own facts and length target, seeing what was already written. Over-long slots are tightened once | — |
| **review** | Code checks + an AI fact-checker. Must-fix problems go back to *write* for **sentence-level** fixes, up to **3 rounds** | After 3 rounds the remaining items are shown to you |
| **channels** | Builds the publishable text: your headings, `[1][2]` source numbers, a footer with the access date, a Sources list, and an *image plan* (no image links — see [section 11](#11-posting-your-article)) | — |
| **final** | A last check that **reports but never approves** | — |

Then the job stops and waits for **you**.

## 7. Reading the result

Open the job from **All jobs**. From top to bottom:

**Status**

| Status | Meaning |
|---|---|
| `ready_for_review` | Passed the internal checks. Waiting for you. *Not* an approval. |
| `needs_revision` | Some must-fix items remain after the internal rounds. You can read them, send it back, or approve anyway after acknowledging them. |
| `approved` | You approved this exact file. |
| `cancelled` | You cancelled it. |
| `error` | A stage failed. The error is shown on the job. |

**The gate card** (green or amber) lists:

- **Blockers** — must-fix items, each with the *kind* (e.g. `unsupported`, `misattributed`, `duplicate_paragraph`), the **exact sentence**, why it is a problem, and a suggested fix.
- **Notes** — things that do not block but you should know: word count outside the range, facts kept out, sources that could not be opened, paragraphs removed automatically.
- **Evidence base: thin / enough** — computed from the verified facts and the source organisations. It warns, for example, when 90% of the facts come from one agency. Revising the text cannot create evidence; if the base is thin, add independent source links or accept a shorter article.
- **Style / repetition observations** — advisory only.

**Issue kinds you will meet**

| Kind | Meaning |
|---|---|
| `unsupported` | A fact, number, date, name or event not in the verified facts or the sources |
| `embellished` | Detail added beyond the original, or a meaning made stronger |
| `misattributed` | A quote or opinion given to the wrong person or outlet (code double-checks this against the source) |
| `incomplete` | A multi-sided story told from one side only |
| `fabricated_experience` | An experience or scene presented as real without evidence |
| `repetition` / `duplicate_paragraph` | Retelling to add length |
| `hypothetical_opening` | The hook starts with "Imagine…" or "You just…" instead of a real event |
| `cjk` | Chinese/Japanese/Korean characters appeared in text that should be English or Thai |
| `leaked_json` | Raw model output leaked into the article |
| `word_count` | Outside the target range (does not block) |

There is **no numeric quality score**, on purpose: a number would suggest a precision the method does not have.

Below the card is the article exactly as the file `blockdit.md` contains it — the file your approval will be bound to.

### What the checks can and cannot catch

This is the most important thing to understand about OBA. **"Ready for human review" does not mean "correct".**

| The system **does** catch | The system **can miss** — so you must look |
|---|---|
| A number, name, date or quote that is **not in the page it cites** (checked in code) | A sentence with **no number, name or quote** that simply states something the sources never said — e.g. *"the host has not yet announced its plan"* or *"the agenda is not yet confirmed"*. Plausible guesses can pass |
| A fact whose supporting quote is not found in the fetched page → kept out | **Who said it.** The article may call a source *"the institution's own description"* when the page is really a Wikipedia summary. Check the wording against the Sources list |
| Duplicate **paragraphs**, a hook that opens with "Imagine…", raw JSON, CJK characters | **Repeated sentences and ideas** inside or across sections. Repetition is reported as an *observation*, not a blocker; the same fact can appear three or four times |
| An evidence base that is thin (one organisation, few facts) → a note on the gate card | **Whether the sources are the right ones.** If a search brought in unrelated pages, the facts may still all be "verified" against them |
| Claims made without a source for added content (in the MCP final check) | **Time.** The system does not know today's date. An event that has already happened can be written about in the future tense, and the reverse |
| — | **Stale or changed facts.** A page can be out of date. *Re-check the sources* (section 9) only tells you whether the page changed, not whether it is right |
| — | **Fairness and emphasis.** Whether the article gives the right weight to each side is a human judgement |

The checks tie text to sources. They never judge the sources, the framing, or common sense.

### Your checklist before you click Approve

Take two minutes. If any answer is "no", **send it back** with a specific instruction, or cancel.

1. **Sources.** Open the Sources list. Are they what you would cite yourself? Is there more than one independent organisation? (The gate card's *Evidence base* line tells you; *thin* means treat the article with suspicion.)
2. **Every sentence that states something new.** Does it have a `[n]` marker? Be suspicious of any sentence about *what has not happened*, *what is expected*, *what someone thinks*, or *why* — these are where unsourced guesses hide.
3. **Who said what.** Find every "according to", "said", "the institution's description". Does it name the right source?
4. **Dates and tense.** Is the article's timeline true **today**? Is an event described as upcoming that has already happened?
5. **Repetition.** Does the same fact appear more than once? If the article feels padded, the evidence was probably too thin for the target length — ask for a shorter piece or add sources.
6. **The hook and the close.** Do they match what the body actually proves?
7. **Run the fact check** (section 9) and open every *Check yourself* and *High-risk* item.
8. **Numbers and names you would repeat in public.** Open the source and read the line yourself.
9. **Would you put your name on it?** (The voice library asks the owner to answer this at the Human Gate; the AI must not.)

An approval means *you* vouch for the file. That is the point of the gate.

## 8. The Human Gate

The decision panel sits above the article. **Read the whole article first.**

- **Your name** — recorded with the decision.
- **Note** — required when you send it back (say exactly what to change, e.g. *"cut the paragraph about the stock"*).

| Button | What happens |
|---|---|
| ✅ **Approve** | Records your name, time, note and the **SHA-256 hash of the file you were shown**. If blockers remain you must confirm that you read them. |
| ✏️ **Send back for edits** | Your instruction plus any remaining blockers go to the writer, which fixes them **sentence by sentence** in the existing draft and re-runs the checks. A new version is created. |
| ✖ **Cancel** | Marks the job cancelled. |

What the hash binds: if the file on disk differs from what was approved — even one character, even by you in an editor —
the approval is shown as **invalid** and the file cannot be approved or revised until you cancel or rebuild. The page also refuses a
decision made on a stale copy ("the version you opened is not the latest — reload").

An approved job can still be sent back or cancelled, but not approved twice.

**Why the buttons only work from the page:** decisions are accepted only from requests that carry the browser's own
`Origin`/`Sec-Fetch-Site` headers, so a script, a `curl` call or an AI tool cannot approve by accident. This stops
*accidents*, not a determined local attacker — OBA is a single-user tool, not an authentication system.

## 9. Checking facts before you post

For `ready_for_review`, `needs_revision` and `approved` jobs, the panel has a **Fact check before posting**:

- **Check the approved version** — compares every **number, proper name and quoted passage** in the text with the source that sentence cites (`[n]`). Written by code, no AI. It lists *Check yourself* items and *High-risk items* (allegations, legal matters, quotes, single-source facts) first, and writes `fact_check.md` into the job folder.
- **Check the pasted text** — if you edited the article after approval, paste the version you will really post. It must keep the `[1] [2]` numbers.
- **Deep check** — also searches for a **second independent source** for high-risk single-source facts and asks Google Fact Check Tools about allegations and quotes. Small search cost; needs a Tavily/Serper key (and optionally `GOOGLE_FACTCHECK_API_KEY`). Finding nothing does **not** mean a claim is true.
- **Re-check the sources** *(approved jobs)* — opens every cited link again and compares with the copy made at writing time; warns about pages that disappeared, changed a lot, or lost the confirming quote. Use it before and after publishing.

What it can and cannot tell you: it certifies that *the text matches the cited source*; it does **not** certify that the source is right. Numbers written as words in the article and currencies are not checked.

## 10. Versions and what changed

Every version sent for review is stored under `versions/v<N>/` in the job folder — never overwritten, never deleted.
Click **List / compare what changed** to see each version with its word count and decisions, and compare any old version
with the current one paragraph by paragraph (red = removed or changed from, green = added or changed to).

## 11. Posting your article

OBA **never posts**. After approval:

1. **Blockdit / long-form channel** — copy the article (📋 *Copy* or *Download .md*) and post it yourself. The text has `[1][2]` numbers and a Sources list.
2. **Images** — OBA writes an **image plan** (`image_plan.md` and the *Image prompts* box) but produces no images and puts **no image links** in the article, so it never claims an image that does not exist. When you add images: use only images you have the right to use, credit them, and label AI-generated images as AI. A mock-up is not evidence of an event.
3. **Website** — the *Website category code* panel suggests a code from the pillar (an example mapping in `src/webCategory.mjs`; edit it for your site). **Plain HTML page** in *Drafts for other channels* gives an escaped HTML version.
4. **Facebook, X, LinkedIn, newsletter, short-video script** — use **Drafts for other channels**. Each draft is generated from the **approved** version only, by the same AI model, with the instruction to add no new facts. They are **untested on the real platforms** — read every draft before using it. Drafts are also saved under `data/exports/`.
5. When you have posted, press **📌 Record as posted**. It is only a record (for the dashboard). If the fact check still has items it could not match, it asks you to confirm that you checked them yourself.

## 12. Final check with Claude (MCP)

You can let Claude (Desktop or Code) do a **final check** of an approved article: compare numbers, names and quotes with the
sources, tidy the language, prepare a Blockdit version (no `[n]`) and a web version (with `[n]`), and write a **change report** that tells you
exactly what changed and why — so you review the *changes*, not the whole article again.

The MCP server has **five tools** and no way to publish, approve, edit the job state or read your `.env`. Setup and rules: **[docs/MCP.md](MCP.md)**.

## 13. Make it yours: rules, templates, voice

The `rules/` folder holds **example** rules. They are read fresh for every job — edit a file and the next job follows it, no restart.

| File | Contains |
|---|---|
| `rules/AUTOMATION_RULES.md` | The central rules: goal, sequence, evidence standards, template guidance, review and delivery, the Human Gate |
| `rules/OntheBridge_Voice_Library_v1.0.md` | Voice principles; **the words to avoid** (one comma-separated line the code scans for); voice examples |
| `rules/BLOCKDIT_FORMAT.md` | The long-article channel format: sections, word count, images and sources |
| `rules/Template/blockdit_article.md` | The layout the AI must follow for that channel |
| `rules/Template/*.yaml` | The five templates: stages, purpose, guiding questions, length hints |

Rules you must keep to when editing — [docs/RULES.md](RULES.md) lists them: the `## Section headings` are looked up **by name**;
the avoid-words line is parsed by the code; each YAML's stage `name:` values must match the slot map in `src/rules.mjs`.
The shipped files are written in English. A Thai (or other-language) publication should write its own — the model follows
whatever language the rules are in, and you choose the article language per job.

## 14. Models, languages and cost

**Providers and models** (menu in the page)

| Provider | Models | Notes |
|---|---|---|
| DeepSeek | `deepseek-flash` (default), `deepseek-v4-pro` | The most exercised. OBA turns the "thinking" mode **off** for these models, because left on they can spend the whole answer budget thinking and return nothing |
| Anthropic | Sonnet 5.5, Haiku 5.5, Haiku 4.5, Opus 5.5 | OBA sets the right thinking parameter for each model. In our tests Haiku models finished the job but wrote **below the standard** of the larger ones |
| OpenAI, Gemini, OpenRouter | listed in the menu | Available but **not exercised on whole jobs** |

**Which model should I use?** The quality of the writing depends on the model. The checks do not change, but a weaker model
writes weaker articles and needs more revision rounds. We have tested **DeepSeek** (Flash: whole jobs passed our standard —
our verified, inexpensive baseline) and **Claude** (Haiku 4.5/5.5: finished but below our standard; Sonnet 5.5 and Opus 5.5:
connection verified, **whole job not yet run**). If cost is not a concern, we recommend trying a larger Claude model
(Sonnet or Opus) because bigger models generally write better — this is an expectation, not something we measured.
To decide for yourself, run the same topic on two models and compare the revision rounds and the facts that passed.

**Language** — per job. English targets 1,200–1,800 words, Thai 1,500–2,200. To change a range, edit the profile in `src/language.mjs`
(and keep `rules/BLOCKDIT_FORMAT.md` consistent).

**Cost** — a job makes roughly 12–30 model calls (several are large: the evidence stage sends the page texts). The **Insights** tab
shows estimated totals per month and provider from the rate tables in `src/skills/costTracker.mjs`. **Those tables are estimates;
check your provider's pricing page and edit the numbers.** The provider's own billing page is the truth.

## 15. Where your files are

Everything for one job is in `data/jobs/OBA-xxxxxxxx/` (the **Open the folder** button shows it):

| File / folder | What it is |
|---|---|
| `state.json` | The job: input, every stage result, decisions. API keys are never in it |
| `sources/src1.txt …` | The full text of every page that was opened |
| `blockdit.md` | **The review file** — what you read and what an approval is bound to |
| `image_plan.md` | Proposed illustrations |
| `fact_check.md` | The latest fact-check table |
| `versions/v1, v2 …` | A copy of every version sent for review |
| `final/r1, r2 …` | Output of the MCP final check (new files only) |
| `web_meta.json` | The website category code you chose |

Elsewhere in `data/`: `costs.json`, `analytics.json`, `exports/`, `skills/memory.json` (the review-issue counts shown on the Insights tab).
`data/` is git-ignored. **Back it up** if your articles matter to you — it is just files.

To delete a job, use the 🗑️ in **All jobs** (this removes the job folder).

## 16. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `API key for … not set` | No key in `.env` and none typed in the page. Add it and restart |
| `DeepSeek API error: 401` | Key invalid or revoked |
| `402 (insufficient balance)` | Top up the provider account |
| *"DeepSeek did not answer within 240 seconds"* | The provider is queueing or down. Check its status page and run again later |
| *"Research found no readable sources"* | No search key, or the topic is too narrow. Add a Tavily/Serper/Brave key; broaden the topic; or paste a link/transcript |
| *"Evidence: no fact passed the check"* | The sources did not contain checkable quotes. Add better links or a transcript |
| Page shows an error / blank | Open the browser console (F12). Make sure you opened `http://127.0.0.1:PORT` exactly (not `localhost` on a different port) |
| `403 Forbidden` from the API | The request did not come from OBA's own page (wrong host, foreign origin). Use the page |
| A page I gave is "refused" | OBA will not fetch private/loopback/local addresses (SSRF protection) |
| Job stuck in `processing` after a crash | Restart the server, then delete the job and run it again |
| Windows: `node` not found | Install Node.js 22+ and reopen the terminal; or use the full path in `start.bat` |
| Garbled Thai in the Windows console | Cosmetic; the files are UTF-8 |

## 17. FAQ

**Does it publish for me?** No, and it cannot: there is no publisher and no platform credential anywhere.

**Is the article "fact-checked"?** It is *checked*: facts are tied to sources that were opened, and quotes are verified in code.
That is not independent expert review. Read it. That is the point of the gate.

**Can I use my own editorial rules?** Yes — that is the intended way to use it. See section 13.

**Can I write in other languages?** The pipeline is language-neutral; English and Thai are the two profiled. See `src/language.mjs`.

**Why do some jobs stop with "needs revision"?** After three internal rounds, must-fix items remain. They are listed so you can fix by instruction, accept, or cancel.

**Can several people use it?** It is a single-user local tool: no login. Several editors can share one machine and enter their names at the gate, but anyone who can open the page can decide.

**Where do I report a security problem?** See [SECURITY.md](../SECURITY.md) — please do not open a public issue for a vulnerability.

## 18. Glossary

| Term | Meaning |
|---|---|
| **Claim** | One extracted fact with an id (`clm1`), a type, its source ids, quotes and a rationale |
| **Verified / needs_verification** | Verified = the quote was found in the opened page. Otherwise it is kept out of the article |
| **Evidence types** | `primary_text`, `study`, `corroborated` (disputed matters need two independent sources), `attributed_testimony` |
| **Slot** | One of four content areas (hook, why, step, actionable) that every template maps its stages onto |
| **Pillar** | A content category label that sets the writing approach |
| **Human Gate** | The decision point: approve / send back / cancel, bound to a file hash |
| **Deliverable** | The review file `blockdit.md` |
| **Blockers / advisories** | Must-fix items / observations that do not block |
| **MCP** | Model Context Protocol — the way Claude connects to local tools |

---

## 19. Appendix A: a real weak run, and what it teaches

We keep this in the manual on purpose: it shows what OBA does when it is given too little, and what you should look for.

**The setup.** Topic: *"IMF World Bank annual meeting in Bangkok 2026"*. English. DeepSeek Flash. **No web-search key.** Template and pillar left to the AI. (October 2026.)

**What happened** — 66 seconds, nine model calls, about 126,000 tokens, an estimated cost of about **$0.05**. All eight stages completed and the job stopped at *ready for human review*.

**What the system did right**

- Every date, venue and quote in the article matched the one page it used (we checked each against the saved source text).
- It flagged the weak base on the gate card: *"Thin evidence base: from only 1 source organisation(s) … 100% of the facts come from one organisation, wikipedia.org"* and *"the source relevance filter was relaxed because fewer than 2 sources remained."*
- It did not invent numbers or names, and it did not approve or publish anything.

**What went wrong, and what you can learn from each**

| What we found | Why it happens | What to do |
|---|---|---|
| Only Wikipedia was used, and unrelated pages (Israel, the economy of China, …) were fetched too | No search key; DuckDuckGo returned nothing; when too few pages match the topic the filter *relaxes* so the job can continue | Add a search key. Read the gate card's notes |
| About 1,300 words were written from a handful of facts, so the same fact (the 1991 meeting in Bangkok) appeared four times, once as the same sentence twice in a row | The target length is a goal; the writer padded to reach it. The check for duplicates works on **paragraphs**, and repetition is only an *observation* | Read for repetition; ask for a shorter piece; add sources instead of length |
| *"Bangkok has not yet said which approach it will take"* and *"agenda and outcomes are not yet confirmed"* | No source says this. It is a plausible guess with no number, name or quote, so the checks did not see it | Be suspicious of every sentence about what has *not* happened or what is *expected* |
| Text attributed to *"the institutions' own description"* | The page was a Wikipedia article, not the institutions' own text | Compare attributions with the Sources list |
| The article was written as if the meetings were still ahead, although the system date was the last day of the meetings | The system does not know today's date; the source had no "as of" date | Check time-sensitive wording yourself |

**The lesson.** OBA made the problems *visible* (a thin-evidence warning, repetition observations, a Sources list that is one Wikipedia page) and kept every checkable fact honest. It did **not** turn a thin input into a good article, and it did not catch a few plausible guesses. That is the division of labour: the system makes a draft you can audit; **you decide whether it is good enough**. If you cannot give it better sources, a shorter or different piece — or no article — is the right outcome.

