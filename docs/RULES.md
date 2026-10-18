# Writing your own rules

OBA reads its editorial rules from the `rules/` folder **for every job**. Edit a file and the next job follows it — no restart.
The files that ship are **examples** adapted from the OnTheBridge publication. Copy the style, replace the content.

Nothing in `rules/` is executed; it is text given to the AI (and a few words the code scans for). So the quality of your rules is the
quality of your editorial control — and they are *yours*: they live in plain files you can version, review and share.

## Files

```
rules/
├─ AUTOMATION_RULES.md                  central rules
├─ OntheBridge_Voice_Library_v1.0.md    voice and words to avoid
├─ BLOCKDIT_FORMAT.md                   the long-article channel format
└─ Template/
   ├─ blockdit_article.md               layout instructions for that channel
   ├─ reflective.yaml
   ├─ explainer_howto.yaml
   ├─ opinion_column.yaml
   ├─ feature_narrative.yaml
   └─ news_analysis.yaml
```

The file *names* are referenced from `src/rules.mjs`. If you rename a file, change the constants at the top of that file.

## What the code requires (and what is free text)

### Section headings are looked up by name

`src/rules.mjs` extracts sections by their **exact `## Heading`**. You may rewrite everything *under* a heading; keep the headings.

| File | Headings the code looks for | Used in stage |
|---|---|---|
| `AUTOMATION_RULES.md` | `## Goal`, `## Sequence`, `## Templates and voice` | brief |
| | `## Evidence` | evidence, write, review |
| | `## Review and delivery` | review |
| `OntheBridge_Voice_Library_v1.0.md` | `## Principles`, `## Words to avoid in the narrator's voice`, `## Voice examples (3 pairs)` | write, review |
| `BLOCKDIT_FORMAT.md` | `## Format adopted` | write |
| `Template/blockdit_article.md` | `## Writing instructions` | write |

A missing heading means that part is silently left out of the prompt — so after editing, run `npm test`: the *rule loader* tests check that the main sections are found (Goal, Evidence, Review and delivery, Principles, Writing instructions, the avoid-words line, and every template's stage names).
(`## Human Gate` and the other headings in the examples are for people; the code does not use them.)

### The words to avoid are a data line

Under `## Words to avoid in the narrator's voice`, the **first non-empty line** must be a comma-separated list. The code scans every article for those words (case-insensitive) and reports each hit as an *observation* (it never blocks, because a direct quote from a source may legitimately contain one). Entries longer than 20 characters are ignored.

### Pillars

A **Pillar** is a content category label (the examples use five: Human+AI, Life Skills, Documentary, Questions, Legacy). They appear in three places that must agree:

1. `PILLARS` in `src/rules.mjs`
2. the line `Human+AI / Life Skills / Documentary / Questions / Legacy` in `AUTOMATION_RULES.md` (a test checks it)
3. the `<select id="pillar">` options in `public/index.html`

Change all three together, update the per-pillar guidance in `AUTOMATION_RULES.md`, and `DEFAULT_CODE` in `src/webCategory.mjs` if you use website category codes.

### Templates (YAML)

Each template has four things the code relies on:

- `template_id` — must equal the file name and an entry of `TEMPLATE_IDS` in `src/rules.mjs`.
- `stages:` — each with a `name:`. **The `name` values must match `SLOT_MAP` in `src/rules.mjs`**, which maps your stages onto the four internal slots (`hook`, `why`, `step`, `actionable`). A test checks it.
- `purpose`, `guiding_questions`, `length_hint` — free text for the AI.
- `metadata` — informative.

The four slots exist because review, revision, word counting and the page all share them. A template with six stages (like *reflective*) simply maps two stages to one slot.

To add a template: add the YAML, add its id to `TEMPLATE_IDS`, add its stages to `SLOT_MAP`, add an `<option>` to the template `<select>` in `public/index.html`.

### Lengths

The *target range* is set per language in `src/language.mjs` (`wordRange` and `sectionTargets`). The rules text should state the same range so the writer and the checker agree. A test checks that the per-slot targets add up to the language's range.

## Writing guidance that works

- **Say what is forbidden, with the reason.** The examples forbid inventing numbers, people, interviews and direct quotes; assuming the reader ("You just…"); opening with a hypothetical.
- **Separate fact from opinion** and require opinion to be marked as opinion ("the writer sees", "may").
- **Keep Human Gate language** in the central rules: approval applies only to the file a person read; praise, silence and a passed check are not approval.
- **Do not ask for scores.** The system reports concrete issues with the exact sentence.
- **Write in the language you publish in.** The AI follows the language of the rules; the article language is chosen per job.
- **Change one thing at a time** and compare two runs of the same topic.

## Other languages

The example rules are English. A Thai (or other) publication should write its own, and choose the matching article language in the page. Add a profile in `src/language.mjs` for a new language (target length, per-slot targets, a few patterns).
