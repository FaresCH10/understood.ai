import {useLayoutEffect, useRef, type MouseEvent, type PointerEvent} from 'react';

const swipeSurface = '[data-worker-swipe-tabs]';
const editableControl = 'input, textarea, select, [contenteditable]';

export function useWorkerSwipeTabs<T extends string>(
  tabs: readonly T[],
  selected: T,
  select: (tab: T) => void,
  {enabled, rtl}: {enabled: boolean; rtl: boolean},
) {
  const start = useRef<{id: number; x: number; y: number; offset: number; animate: boolean} | null>(null);
  const suppressClick = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const incoming = useRef<{tab: T; from: number} | null>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const slide = incoming.current;
    incoming.current = null;
    start.current = null;
    panel?.style.removeProperty('transform');

    if (enabled && slide?.tab === selected && panel) {
      animation.current = panel.animate(
        [{transform: `translateX(${slide.from}px)`, opacity: 0.65}, {transform: 'translateX(0)', opacity: 1}],
        {duration: 180, easing: 'ease-out'},
      );
    }
    return () => animation.current?.cancel();
  }, [selected, enabled]);

  const adjacentTab = (x: number) => tabs[tabs.indexOf(selected) + (x < 0 ? 1 : -1) * (rtl ? -1 : 1)];

  function settle(offset: number) {
    const panel = panelRef.current;
    panel?.style.removeProperty('transform');
    if (!panel || !offset) return;

    animation.current = panel.animate(
      [{transform: `translateX(${offset}px)`}, {transform: 'translateX(0)'}],
      {duration: 160, easing: 'ease-out'},
    );
  }

  const handlers = {
    'data-worker-swipe-tabs': '',
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (start.current) settle(start.current.offset);
      start.current = null;
      suppressClick.current = false;
      if (!enabled || event.pointerType !== 'touch' || !event.isPrimary) return;

      const target = event.target;
      if (!(target instanceof Element) || target.closest(editableControl)) return;
      if (target.closest(swipeSurface) !== event.currentTarget) return;

      animation.current?.cancel();
      const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      start.current = {id: event.pointerId, x: event.clientX, y: event.clientY, offset: 0, animate};
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      if (gesture?.id !== event.pointerId) return;

      const x = event.clientX - gesture.x;
      const y = Math.abs(event.clientY - gesture.y);
      if (y > 12 && y >= Math.abs(x)) {
        settle(gesture.offset);
        start.current = null;
        return;
      }
      if (!gesture.animate || Math.abs(x) < 8 && !gesture.offset) return;

      const atEdge = adjacentTab(x) === undefined;
      const limit = atEdge ? 36 : 110;
      const distance = atEdge ? x * 0.25 : x;
      gesture.offset = Math.max(-limit, Math.min(limit, distance));
      panelRef.current?.style.setProperty('transform', `translateX(${gesture.offset}px)`);
    },
    onPointerCancel(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      if (gesture?.id !== event.pointerId) return;
      settle(gesture.offset);
      start.current = null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      if (gesture?.id !== event.pointerId) return;
      start.current = null;
      const x = event.clientX - gesture.x;
      const y = event.clientY - gesture.y;
      const horizontal = Math.abs(x) >= 56 && Math.abs(x) >= 1.4 * Math.abs(y);
      const next = enabled && horizontal ? adjacentTab(x) : undefined;

      // A drag starting on a card must not also activate its click handler.
      suppressClick.current = horizontal || Math.abs(gesture.offset) > 12;
      if (next === undefined) {
        settle(gesture.offset);
        return;
      }

      if (gesture.animate) incoming.current = {tab: next, from: x < 0 ? 48 : -48};
      select(next);
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current || event.detail === 0) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return {handlers, panelRef};
}
