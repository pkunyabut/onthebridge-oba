# Contributing

Thank you for looking. This project is about **trust in what an AI-assisted article says**, so the bar for changes is
"does this keep the system honest?".

## Ground rules

These invariants are not up for trade-off:

1. **No publisher.** OBA never posts to a platform and holds no platform credentials.
2. **Approval is bound to a file hash** and only the owner's page can record it.
3. **A fact needs a quote that was found in a page the system opened.** Checks that decide this stay in code, not in the model.
4. **No unmeasurable scores.** Report concrete issues with the exact sentence.
5. **Local only.** No change may make the server listen on anything but `127.0.0.1` by default.

A pull request that weakens one of these will be declined, however useful it looks.

## Development

```bash
npm install
npm test            # offline, no key, no cost
npm start           # http://127.0.0.1:8080
```

- Node.js 22+, ES modules, **no build step** and (almost) no dependencies — please think twice before adding one.
- Tests use `node:test`. Add a test with every fix. `tests/pipeline.test.mjs` runs a whole job against a stubbed network: extend it when you touch a stage.
- Comments explain *why* (a real failure, a provider quirk). If you fix a bug found in real use, say what happened in a short comment.
- Keep prompts in English; the article language is a per-job setting (`src/language.mjs`).

## Good first contributions

- Real-world reports of how a model/provider behaves (thinking parameters, token limits, JSON habits).
- A language profile (`src/language.mjs`) with sample rules and a test.
- Better example rules in `rules/` (they should stay generic — no one publication's private policies).
- Documentation fixes — if a step in the guide failed for you, that is a bug.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, Node version, provider/model, and the **job's `state.json` stage that failed** with keys and personal text removed.
**Never paste API keys.** For security problems, follow [SECURITY.md](SECURITY.md) instead.

## Pull requests

- One topic per PR; explain the problem first.
- `npm test` must pass.
- Do not commit anything under `data/` or any `.env`.
