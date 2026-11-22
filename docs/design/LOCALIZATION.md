# Localization

Raz, 2026-11-22: the share video (and every text) is defined once, and each
audience gets its own localization unit, written in its own words, not
translated word for word.

## The standard we use

- **ICU MessageFormat** strings (FormatJS / react-intl, Android, iOS use the
  same syntax), in **one JSON file per locale** under
  `frontend/src/i18n/locales/`, named by **BCP-47 tag**.
- `en.json` is the source: every key exists there. A language file (`he.json`)
  says it in that language. A regional or audience file (`he-IL.json`, or a
  private-use tag such as `he-IL-x-class` for class mode) holds **only the keys
  that differ**.
- Lookup is key by key along the fallback chain `he-IL-x-class` → `he-IL` →
  `he` → `en`. A missing key falls back; it never crashes.
- `$meta` in each file: the language's own name, `dir` (`ltr`/`rtl`), display font.
- Code: `createTranslator(locale, files).t('shareVideo.f1.title', { child })`
  (`frontend/src/i18n/index.ts`). The video renderer reads the same files.

## Rules for writing messages

1. **Grammar lives in the message.** Code never glues sentences together.
2. **Gender:** `{childGender, select, female {…} male {…} other {…}}`. `other`
   is gender-neutral and is what shows when we do not know (we never ask by
   default). In Hebrew build the neutral form around the noun ("הציור של דן").
3. **Optional values:** `{hasChild, select, yes {…} other {…}}`: the sentence
   reads well with and without the child's name.
4. **Counts:** `{n, plural, one {…} other {…}}`; Hebrew and Arabic have more forms.
5. One sentence per line on screen; a long translation steps the size down,
   never wraps a sentence.
6. Keys are stable and named by place: `screen.part.role` (`shareVideo.f4.title`).
7. The child's name is a value, never part of a key, never sent to analytics.

`npm test` checks that every file parses as ICU, has `$meta`, and has no key
the source lacks.
