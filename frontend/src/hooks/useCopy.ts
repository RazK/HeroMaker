import { useCallback, useEffect, useState } from 'react';

/**
 * Copy text to the clipboard, and remember that it was copied so the button
 * can say so. `copied` stays true until `resetMs` passes, or for good when
 * `resetMs` is left out.
 *
 * When the browser refuses the clipboard, `promptLabel` opens a prompt holding
 * the text to copy by hand. Without it, nothing happens: the text is already
 * on screen to select.
 */
export function useCopy(resetMs?: number) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied || !resetMs) return;
    const t = window.setTimeout(() => setCopied(false), resetMs);
    return () => window.clearTimeout(t);
  }, [copied, resetMs]);
  const copy = useCallback(async (text: string, promptLabel?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      if (promptLabel) window.prompt(promptLabel, text);
    }
  }, []);
  return { copied, copy };
}
