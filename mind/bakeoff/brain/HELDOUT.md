# Held-out cases

Cases in `heldout/` were written by someone who never saw the brain's prompt, its examples or `cases.json`, and they
are committed before any model is scored on them. They measure how the brain and the fast lane do on requests nobody
tuned for. `cases.json` is the tuned set: everything in it has been seen while a prompt, an example or a lesson was
being written.

## The rule

A held-out file stays held out only while nothing is changed because of what it showed. The commit that adds a lesson,
an example, a prompt line or a fast-lane template after reading a held-out failure also moves that file's cases into
`cases.json` (they become tuned) and says so. The next honest measure is a new file, `held2`, written the same blind way.

`run.js` loads every file here as held out, prints strict on the tuned and held-out sets apart, and gates on the
held-out numbers.

## Files

| File | Written | By | Cases | sha256 |
| --- | --- | --- | --- | --- |
| `heldout/held1.json` | 8 Nov 2026, 12:20 | a fresh agent given only the gesture, trick and action names with their one-line meanings, the event shape and the case format; it read no file | 30: 12 device actions (all six), 8 gestures and tricks, 10 chat and negation | `52f30069a32870be32727bd486cc5a093023cd709f677adfbacced4daf700289` |

The fast lane's templates (`orchestrator/fastlane.js`) were written before `held1` was read: that file's sha256 then was
`398c9b511894c03a7c8859e0a8a1d389199eb2405f3094adc9d86d9e02ad4373`.
