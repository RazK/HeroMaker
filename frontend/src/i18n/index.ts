/**
 * Localization: ICU MessageFormat strings, one JSON file per locale (BCP-47
 * tags), resolved through a fallback chain. The industry-standard shape
 * (FormatJS / react-intl, Android, iOS): the code names a key and passes
 * values; each locale's file says the sentence in its own words.
 *
 * - `locales/en.json` is the source: every key exists there.
 * - A language file (`he.json`) translates; a regional or audience file
 *   (`he-IL.json`, later e.g. `he-IL-x-class.json`) overrides only what differs.
 * - Lookup: `he-IL` -> `he` -> `en`, key by key.
 * - Grammar lives in the message, not in code: `select` for the child's
 *   gender (with a neutral `other`, used when it is not known), `plural` for
 *   counts. Code never concatenates sentences.
 * - `$meta` holds the locale's direction and display font.
 *
 * The share-video renderer reads the same files, so the app and the video
 * always say the same thing. docs/design/LOCALIZATION.md has the rules.
 */
import { IntlMessageFormat } from 'intl-messageformat';

export type Messages = Record<string, unknown> & { $meta?: LocaleMeta };
export interface LocaleMeta { name: string; dir: 'ltr' | 'rtl'; font?: string }
export type Values = Record<string, string | number | boolean | null | undefined>;

export const SOURCE_LOCALE = 'en';

/** `he-IL` -> ['he-IL', 'he', 'en']; never repeats, always ends at the source. */
export function fallbackChain(locale: string): string[] {
  const parts = locale.split('-');
  const chain: string[] = [];
  for (let i = parts.length; i > 0; i--) chain.push(parts.slice(0, i).join('-'));
  if (!chain.includes(SOURCE_LOCALE)) chain.push(SOURCE_LOCALE);
  return chain;
}

/** Pick the best locale we have for what the browser (or the parent) asks for. */
export function negotiate(wanted: readonly string[], available: readonly string[]): string {
  for (const w of wanted) {
    for (const tag of fallbackChain(w)) if (available.includes(tag)) return tag;
  }
  return SOURCE_LOCALE;
}

/** Messages for `locale`, each key taken from the first file in its chain that has it. */
export function resolveMessages(locale: string, files: Record<string, Messages>): Messages {
  const out: Messages = {};
  for (const tag of fallbackChain(locale).reverse()) Object.assign(out, files[tag] ?? {});
  return out;
}

export function createTranslator(locale: string, files: Record<string, Messages>) {
  const messages = resolveMessages(locale, files);
  const cache = new Map<string, IntlMessageFormat>();
  const t = (key: string, values: Values = {}): string => {
    const src = messages[key];
    if (typeof src !== 'string') return key;  // a missing key shows itself, never crashes
    let fmt = cache.get(key);
    if (!fmt) { fmt = new IntlMessageFormat(src, locale); cache.set(key, fmt); }
    const v: Values = { hasChild: values.child ? 'yes' : 'no', childGender: 'other', ...values };
    return String(fmt.format(v as Record<string, string>));
  };
  return { t, meta: (messages.$meta ?? { name: locale, dir: 'ltr' }) as LocaleMeta, locale };
}
