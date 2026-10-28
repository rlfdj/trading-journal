// viewer.js — full-screen screenshot viewer.
// Pinch or double-tap to zoom, drag to pan when zoomed, swipe sideways
// between screenshots, swipe down (or tap ×) to close.

import { icons } from './ui.js';

const MAX_SCALE = 5;

export function openViewer(urls, start = 0) {
  if (!urls.length) return;
  let index = Math.max(0, start);
  let scale = 1, tx = 0, ty = 0;   // zoom transform of the current image
  let slide = 0, drop = 0;         // swipe offsets while not zoomed
  const pointers = new Map();
  let gesture = null;
  let lastTap = 0;

  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', 'Screenshot');
  v.innerHTML = `
    <div class="viewer-stage"><img alt="Chart screenshot" draggable="false"></div>
    <button class="icon-btn viewer-close" aria-label="Close">${icons.close}</button>
    ${urls.length > 1 ? `
      <button class="icon-btn viewer-prev" aria-label="Previous screenshot">${icons.left}</button>
      <button class="icon-btn viewer-next" aria-label="Next screenshot">${icons.right}</button>
      <div class="viewer-count num"></div>` : ''}`;
  document.body.appendChild(v);
  const stage = v.querySelector('.viewer-stage');
  const img = v.querySelector('img');
  const count = v.querySelector('.viewer-count');

  const apply = (animate) => {
    img.style.transition = animate ? 'transform 0.2s ease-out' : 'none';
    img.style.transform = `translate(${tx + slide}px, ${ty + drop}px) scale(${scale})`;
    v.style.backgroundColor = `rgba(0,0,0,${0.94 * (1 - Math.min(1, Math.abs(drop) / 400))})`;
  };
  const show = (i) => {
    index = (i + urls.length) % urls.length;
    img.src = urls[index];
    scale = 1; tx = 0; ty = 0; slide = 0; drop = 0;
    apply(false);
    if (count) count.textContent = `${index + 1} / ${urls.length}`;
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    v.classList.add('closing');
    setTimeout(() => v.remove(), 160);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && urls.length > 1) show(index - 1);
    else if (e.key === 'ArrowRight' && urls.length > 1) show(index + 1);
  };
  document.addEventListener('keydown', onKey);

  /** Keep a zoomed image from being panned off screen. */
  const clamp = () => {
    const r = stage.getBoundingClientRect();
    const w = img.offsetWidth * scale, h = img.offsetHeight * scale;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  };
  const zoomAt = (newScale, cx, cy) => {
    const r = stage.getBoundingClientRect();
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    const k = newScale / scale;
    tx = ox - (ox - tx) * k;
    ty = oy - (oy - ty) * k;
    scale = newScale;
  };

  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  };

  stage.addEventListener('pointerdown', (e) => {
    try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const m = mid();
      gesture = { kind: 'pinch', d: m.d, scale, x: m.x, y: m.y, tx, ty };
    } else if (pointers.size === 1) {
      gesture = { kind: 'pan', x: e.clientX, y: e.clientY, tx, ty, t: e.timeStamp, axis: null };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch' && pointers.size === 2) {
      const m = mid();
      const next = Math.min(MAX_SCALE * 1.2, Math.max(0.8, gesture.scale * (m.d / gesture.d)));
      scale = gesture.scale; tx = gesture.tx; ty = gesture.ty;
      zoomAt(next, gesture.x, gesture.y);
      tx += m.x - gesture.x; ty += m.y - gesture.y;
      apply(false);
    } else if (gesture.kind === 'pan') {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (scale > 1.01) {
        tx = gesture.tx + dx; ty = gesture.ty + dy;
      } else {
        if (!gesture.axis && Math.hypot(dx, dy) > 8) gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (gesture.axis === 'x' && urls.length > 1) slide = dx;
        if (gesture.axis === 'y') drop = Math.max(0, dy);
      }
      apply(false);
    }
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (pointers.size === 1 && g && g.kind === 'pinch') {
      // One finger left after a pinch: carry on panning from here.
      const [p] = [...pointers.values()];
      gesture = { kind: 'pan', x: p.x, y: p.y, tx, ty, t: -Infinity, axis: 'free' }; // never a tap
      return;
    }
    if (pointers.size) return;
    gesture = null;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (scale < 1) { scale = 1; tx = 0; ty = 0; } else { scale = Math.min(MAX_SCALE, scale); clamp(); }
      apply(true);
      return;
    }
    const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y);
    if (moved < 8 && e.timeStamp - g.t < 300) {
      // Tap: double-tap toggles zoom.
      if (e.timeStamp - lastTap < 300) {
        if (scale > 1.01) { scale = 1; tx = 0; ty = 0; } else zoomAt(2.5, e.clientX, e.clientY);
        clamp();
        apply(true);
        lastTap = 0;
      } else lastTap = e.timeStamp;
      return;
    }
    if (scale < 1) { scale = 1; tx = 0; ty = 0; apply(true); return; }
    if (scale > 1.01) { scale = Math.min(MAX_SCALE, scale); clamp(); apply(true); return; }
    if (drop > 120) { close(); return; }
    if (Math.abs(slide) > stage.clientWidth * 0.25 && urls.length > 1) {
      const dir = slide < 0 ? 1 : -1;
      slide = -dir * stage.clientWidth;
      apply(true);
      setTimeout(() => show(index + dir), 160);
      return;
    }
    slide = 0; drop = 0;
    apply(true);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  v.querySelector('.viewer-close').onclick = close;
  v.querySelector('.viewer-prev')?.addEventListener('click', () => show(index - 1));
  v.querySelector('.viewer-next')?.addEventListener('click', () => show(index + 1));
  show(index);
}
