import { useCallback, useRef, useState } from 'react';

export interface PreloadWindow {
  /** The currently centered cell index (-1 until known). */
  activeIndex: number;
  /** Last scroll direction. */
  direction: 'up' | 'down';
  /** Call from the list's viewability callback with the first viewable index. */
  setActiveFromViewable: (nextIndex: number | null | undefined, count: number) => void;
  /** Whether `index` should preload its media, given the asymmetric, direction-aware window. */
  shouldPreload: (index: number) => boolean;
}

/**
 * The heart of perceived performance. Tracks the active cell + scroll direction, and answers
 * "should cell `index` preload?" using an ASYMMETRIC window: more cells ahead in the scroll
 * direction (you're about to reach them) than behind. Only the active + windowed cells should
 * mount a real player / prefetch media; everything else stays a cheap placeholder. This keeps
 * native players (and memory) bounded while making TTFF ≈ 0 for the next item.
 *
 * Mirrors the windows used by muxinc/Slop-Social and TheWidlarzGroup/react-native-video-feed
 * (≈5 ahead / 1 behind).
 */
export function usePreloadWindow(ahead: number, behind: number): PreloadWindow {
  const [activeIndex, setActiveIndex] = useState(-1);
  // Refs so `shouldPreload` reads fresh values without being recreated every render.
  const activeRef = useRef(-1);
  const dirRef = useRef<'up' | 'down'>('down');
  const [direction, setDirection] = useState<'up' | 'down'>('down');

  const setActiveFromViewable = useCallback(
    (nextIndex: number | null | undefined, count: number) => {
      if (nextIndex == null || count === 0) return;
      const clamped = Math.max(0, Math.min(nextIndex, count - 1));
      const prev = activeRef.current;
      if (clamped === prev) return;
      const dir = clamped > prev ? 'down' : 'up';
      dirRef.current = dir;
      activeRef.current = clamped;
      setDirection(dir);
      setActiveIndex(clamped);
    },
    [],
  );

  const shouldPreload = useCallback(
    (index: number) => {
      const active = activeRef.current;
      if (active < 0) return index === 0; // before first viewability, warm the opening cell
      if (index === active) return true;
      const dist = index - active;
      const isAhead = dirRef.current === 'down' ? dist > 0 : dist < 0;
      if (isAhead) return Math.abs(dist) <= ahead;
      return Math.abs(dist) <= behind;
    },
    [ahead, behind],
  );

  return { activeIndex, direction, setActiveFromViewable, shouldPreload };
}
