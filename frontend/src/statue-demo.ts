// Dev-only: drives statue-demo.html (see the comment there).
import { StatueStage } from './components/tb/statue3d';

const q = new URLSearchParams(location.search);
const host = document.getElementById('stage')!;
const caption = document.getElementById('caption')!;
if (q.get('mark') === '0') document.getElementById('mark')!.remove();
const w = window as unknown as { statue: StatueStage; statueReady: boolean; setCaption: (a: string, b: string) => void };
w.setCaption = (a, b) => {
  caption.textContent = a;
  if (b) {
    const s = document.createElement('small');
    s.textContent = b;
    caption.appendChild(s);
  }
  caption.style.opacity = a ? '1' : '0';
};
w.statue = new StatueStage(host, {
  modelUrl: q.get('model') ?? undefined,
  printUrl: q.get('print') ?? undefined,
  name: q.get('name') ?? '',
  credit: q.get('credit') ?? '',
  spin: Number(q.get('spin') ?? 0.45),
  manual: q.get('manual') === '1',
  onReady: () => { w.statueReady = true; },
  onError: (e) => { console.error(e); document.title = 'ERROR'; },
});
