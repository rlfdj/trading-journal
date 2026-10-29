// gestures.js — small drag/swipe helpers built on pointer events.
//
// The element's CSS touch-action decides what the browser keeps for itself:
// `pan-y` leaves vertical scrolling to the page and hands us horizontal
// drags; `none` hands us everything. When the browser takes over a gesture
// (e.g. the user scrolls instead), pointercancel ends the drag as cancelled.

const SLOP = 8;          // px before a drag counts, so taps still work
const VELOCITY_MS = 100; // release speed is measured over the last 100 ms

/**
 * drag(el, { axis, shouldStart, move, end })
 *   axis: 'x' or 'y' — the drag direction we care about
 *   shouldStart(e): return false to ignore this pointer
 *   move(dx, dy, e): while dragging (after the slop); dx/dy start from 0 at
 *     the point the drag was recognised, so content never jumps
 *   end({dx, dy, vx, vy, cancelled}): when released; v in px/ms
 * Returns a function that removes the listeners.
 */
export function drag(el, { axis = 'x', shouldStart, move = () => {}, end = () => {} }) {
  let s = null;

  const down = (e) => {
    if (s || (e.pointerType === 'mouse' && e.button !== 0) || (shouldStart && !shouldStart(e))) return;
    s = { id: e.pointerId, x: e.clientX, y: e.clientY, active: false, samples: [] };
  };
  const moveH = (e) => {
    if (!s || e.pointerId !== s.id) return;
    if (!s.active) {
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      const along = axis === 'x' ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx);
      if (!along) { s = null; return; } // wrong direction: leave it to the browser
      s.active = true;
      s.x = e.clientX; // measure from here so the content doesn't jump by the slop
      s.y = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    }
    s.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > VELOCITY_MS) s.samples.shift();
    if (e.cancelable) e.preventDefault();
    move(e.clientX - s.x, e.clientY - s.y, e);
  };
  const finish = (cancelled) => (e) => {
    if (!s || e.pointerId !== s.id) return;
    const st = s;
    s = null;
    if (!st.active) return;
    // A drag shouldn't also count as a click on whatever is under the finger.
    const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', block, { capture: true }), 50);
    // Speed over the recent window, not just the last event (which is ~0 as the finger stops).
    const a = st.samples[0];
    const b = st.samples[st.samples.length - 1];
    const dt = a && b ? Math.max(16, b.t - a.t) : 1;
    const vx = a && b ? (b.x - a.x) / dt : 0;
    const vy = a && b ? (b.y - a.y) / dt : 0;
    end({ dx: e.clientX - st.x, dy: e.clientY - st.y, vx, vy, cancelled });
  };
  const up = finish(false);
  const cancel = finish(true);

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', moveH, { passive: false });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', moveH);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}

/**
 * Horizontal page swipe (calendar months, stats periods). The content follows
 * the finger; a swipe past 20% of the width, or a quick flick, calls
 * onSwipe(+1 | -1) where +1 means "next" (finger moved left). canGo(dir) can
 * refuse, and the content springs back.
 *
 * onSwipe is called the moment the finger lifts, so the next page renders
 * while the current one is still sliding out — no blank pause in between.
 */
export function pageSwipe(el, content, { onSwipe, canGo = () => true, shouldStart }) {
  return drag(el, {
    axis: 'x',
    shouldStart,
    move(dx) {
      const dir = dx < 0 ? 1 : -1;
      const resist = canGo(dir) ? 1 : 0.25;
      content.style.transition = 'none';
      content.style.willChange = 'transform';
      content.style.transform = `translateX(${dx * resist}px)`;
    },
    end({ dx, vx, cancelled }) {
      const dir = dx < 0 ? 1 : -1;
      const flick = Math.abs(vx) > 0.3 && Math.abs(dx) > 20 && Math.sign(vx) === Math.sign(dx);
      const far = Math.abs(dx) > el.clientWidth * 0.2 || flick;
      content.style.willChange = '';
      if (!cancelled && far && canGo(dir)) {
        content.style.transition = 'transform 0.18s cubic-bezier(0.3, 0, 0.8, 0.4), opacity 0.18s';
        content.style.transform = `translateX(${-dir * el.clientWidth * 0.6}px)`;
        content.style.opacity = '0.2';
        onSwipe(dir);
      } else {
        content.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
        content.style.transform = '';
      }
    },
  });
}

/** Mark freshly rendered content so CSS slides it in from the swipe side. */
export function slideIn(content, dir) {
  if (!dir) return;
  content.classList.add(dir > 0 ? 'slide-from-right' : 'slide-from-left');
}

/** Long press: calls fn after `ms` unless the finger moves or lifts first. */
export function longPress(el, fn, ms = 500) {
  let timer = null;
  let start = null;
  let fired = false;
  const clear = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { fired = true; timer = null; fn(e); }, ms);
  });
  el.addEventListener('pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
  // Swallow the click that follows a long press, and the iOS callout menu.
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
