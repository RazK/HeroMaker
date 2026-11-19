import { useState } from 'react';
import { setVisitorTraits, track } from '../../analytics';
import { Sheet } from './parts';
import './AskSheet.css';

/**
 * Two questions while the hero is made (design canvas: WhoFor, approved by
 * Raz). A sheet over the "being made" screen of the first hero made in this
 * browser, never before it is paid for, and once per browser: "What's it
 * for?" and "Who drew it?". Both optional; Skip answers neither.
 *
 * It sends `survey_answered`, and the answers become this anonymous visitor's
 * traits (analytics.ts setVisitorTraits): PostHog person properties, and the
 * filter on our own events is the visitor's `survey_answered`. A visitor who
 * came through a class is not asked what it is for: it is a class.
 */
const KEY = 'hm_asked_who_for';

/** Whether this browser has still to be asked. */
export function shouldAskWhoFor(): boolean {
  try { return !window.localStorage.getItem(KEY); } catch { return false; }
}

type Purpose = 'fun' | 'gift' | 'class' | 'event';
type Who = 'kid' | 'grownup';

const PURPOSES: Array<[Purpose, string]> = [['fun', 'Just for fun'], ['gift', 'A gift'], ['class', 'A class'], ['event', 'An event']];
const WHO: Array<[Who, string]> = [['kid', 'A kid'], ['grownup', 'A grown-up']];

function Picks<T extends string>({ label, options, value, onPick }: {
  label: string; options: Array<[T, string]>; value: T | null; onPick: (v: T | null) => void;
}) {
  return (
    <div className="tb-ask-q" role="group" aria-label={label}>
      <h2 className="tb-ask-title">{label}</h2>
      <div className="tb-ask-picks">
        {options.map(([key, text]) => (
          <button key={key} type="button" className="tb-ask-pick" data-answer={key} aria-pressed={value === key}
            onClick={() => onPick(value === key ? null : key)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WhoForSheet({ askPurpose = true, onDone }: { askPurpose?: boolean; onDone: () => void }) {
  const [purpose, setPurpose] = useState<Purpose | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const finish = (skipped: boolean) => {
    try { window.localStorage.setItem(KEY, new Date().toISOString()); } catch { /* asked again next time */ }
    const answers = {
      ...(askPurpose ? { purpose: (!skipped && purpose) || 'skipped' as const } : {}),
      who: (!skipped && who) || 'skipped' as const,
    };
    track('survey_answered', answers);
    const traits: Record<string, string> = {};
    if (answers.purpose && answers.purpose !== 'skipped') traits.purpose = answers.purpose;
    if (answers.who !== 'skipped') traits.who = answers.who;
    if (Object.keys(traits).length) setVisitorTraits(traits);
    onDone();
  };
  return (
    <Sheet label="Two quick questions" onClose={() => finish(true)} className="tb-ask tb-who-for">
      {askPurpose && <Picks label="What's it for?" options={PURPOSES} value={purpose} onPick={setPurpose} />}
      <Picks label="Who drew it?" options={WHO} value={who} onPick={setWho} />
      <div className="tb-ask-btns">
        <button type="button" className="tb-btn tb-btn--secondary tb-btn--full tb-who-for-skip" onClick={() => finish(true)}>Skip</button>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-who-for-done" onClick={() => finish(false)}>Done</button>
      </div>
    </Sheet>
  );
}
