# Optional Study example notes

The original `lib/study-example.json` is unchanged. Five native HTML `details`
elements are inserted at render time by `lib/study-closer-look.ts`. They start
collapsed and support keyboard activation without extra JavaScript.

To remove all additions, set `CLOSER_LOOK_NOTES_ENABLED` to `false` and redeploy.
To remove a single note, remove its object from the `notes` array.
For complete removal, restore `components/study-example.tsx` to render
`study.html` directly, remove its two added imports, and delete the added helper,
stylesheet, and this document. No changes to the original prose are necessary.
