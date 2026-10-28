// gestures.js — small drag/swipe helpers built on pointer events.
//
// The element's CSS touch-action decides what the browser keeps for itself:
// `pan-y` leaves vertical scrolling to the page and hands us horizontal
// drags; `none` hands us everything. When the browser takes over a gesture
// (e.g. the user scrolls instead), pointercancel ends the drag as cancelled.

const SLOP = 8; // px before a drag counts, so taps still work

/**
 * drag(el, { axis, shouldStart, move, end })
 *   axis: 'x' or 'y' — the drag direction we care about
 *   shouldStart(e): return false to ignore this pointer
 *   move(dx, dy, e): while dragging (after the slop)
 *   end({dx, dy, vx, vy, cancelled}): when released
 * Returns a function that removes the listeners.
 */
export function drag(el, { axis = 'x', shouldStart, move = () => {}, end = () => {} }) {
  let s = null;

  const down = (e) => {
    if (s || (e.pointerType === 'mouse' && e.button !== 0) || (shouldStart && !shouldStart(e))) return;
    s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp, vx: 0, vy: 0, active: false };
  };
  const moveH = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      const along = axis === 'x' ? Math.abs(dx) > Math.abs(dy) : Math.abs(dy) > Math.abs(dx);
      if (!along) { s = null; return; } // wrong direction: leave it to the browser
      s.active = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    }
    const dt = Math.max(1, e.timeStamp - s.lastT);
    s.vx = (e.clientX - s.lastX) / dt;
    s.vy = (e.clientY - s.lastY) / dt;
    s.lastX = e.clientX; s.lastY = e.clientY; s.lastT = e.timeStamp;
    if (e.cancelable) e.preventDefault();
    move(dx, dy, e);
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
    end({ dx: e.clientX - st.x, dy: e.clientY - st.y, vx: st.vx, vy: st.vy, cancelled });
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
 * the finger; a long or fast enough swipe calls onSwipe(+1 | -1) where +1 means
 * "next" (finger moved left). canGo(dir) can refuse, and the content springs back.
 */
export function pageSwipe(el, content, { onSwipe, canGo = () => true, shouldStart }) {
  return drag(el, {
    axis: 'x',
    shouldStart,
    move(dx) {
      const dir = dx < 0 ? 1 : -1;
      const resist = canGo(dir) ? 1 : 0.25;
      content.style.transition = 'none';
      content.style.transform = `translateX(${dx * resist}px)`;
    },
    end({ dx, vx, cancelled }) {
      const dir = dx < 0 ? 1 : -1;
      const far = Math.abs(dx) > el.clientWidth * 0.28 || (Math.abs(vx) > 0.45 && Math.abs(dx) > 30);
      content.style.transition = '';
      if (!cancelled && far && canGo(dir)) {
        content.style.transform = `translateX(${-dir * el.clientWidth}px)`;
        content.style.opacity = '0';
        setTimeout(() => onSwipe(dir), 140);
      } else {
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
