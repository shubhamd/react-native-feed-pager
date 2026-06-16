import type { ReactElement } from 'react';

/**
 * Everything a cell needs to render itself correctly inside the pager.
 *
 * The pager is media-AGNOSTIC: it computes which cell is active and which cells fall inside the
 * preload window, and hands those flags to your `renderItem`. You decide what "active" and
 * "preload" mean for each media type:
 *
 * - video    → `isActive` plays (unmuted), `shouldPreload` loads the source paused, otherwise null source
 * - image    → `shouldPreload` triggers `Image.prefetch`; rendering is otherwise a no-op
 * - carousel → `shouldPreload` prefetches frames; `isActive` may enable auto-advance
 */
export interface FeedItemRenderInfo<T> {
  /** The data item for this cell. */
  item: T;
  /** Flat index in `data`. */
  index: number;
  /** True for the single cell currently centered in the viewport (drives playback). */
  isActive: boolean;
  /**
   * True when the cell is within the asymmetric preload window (active, N ahead in the scroll
   * direction, M behind). Use it to warm media before the user arrives so perceived load ≈ 0.
   */
  shouldPreload: boolean;
  /** The fixed pixel height of every cell (full screen by default). Size your media to this. */
  height: number;
}

export type FeedItemType = string;

export interface FeedPagerProps<T> {
  /** The feed data. Appending to it (infinite scroll) is safe — cells keep their identity. */
  data: readonly T[];

  /** Stable unique key per item. Stability is REQUIRED for correct cell identity. */
  keyExtractor: (item: T, index: number) => string;

  /** Render one full-screen cell. Receives active/preload flags + the fixed height. */
  renderItem: (info: FeedItemRenderInfo<T>) => ReactElement | null;

  /**
   * Optional recycle-pool hint (e.g. the media type). Helps the underlying list group like-shaped
   * cells. Defaults to a single bucket. NOTE: the pager runs Legend List in its default
   * NON-recycling mode for correctness, so this is an optimization hint, not a correctness lever.
   */
  getItemType?: (item: T, index: number) => FeedItemType;

  /**
   * Fixed height of each cell. Defaults to the on-screen height of the pager's own container
   * (measured on first layout). Pass an explicit value to skip measurement (e.g. `Dimensions`).
   */
  itemHeight?: number;

  /** Index to open at (e.g. the tapped tile in a grid → viewer). Default 0. */
  initialIndex?: number;

  /** Fired whenever the centered cell changes. */
  onActiveIndexChange?: (index: number, item: T) => void;

  /** Cells to preload AHEAD of the active cell, in the scroll direction. Default 5. */
  preloadAhead?: number;
  /** Cells to preload BEHIND the active cell (for quick back-scroll). Default 1. */
  preloadBehind?: number;

  /** Multiplier on item height for Legend List's render buffer. Default 2. */
  drawDistanceMultiplier?: number;

  /** % of a cell that must be visible for it to become active. Default 60. */
  viewabilityThreshold?: number;

  /** Infinite scroll: called near the end so you can fetch the next page. */
  onEndReached?: () => void;
  /** Threshold (0–1) for `onEndReached`. Default 0.6. */
  onEndReachedThreshold?: number;

  /** Disable scrolling (e.g. while a gesture/seek is active). */
  scrollEnabled?: boolean;

  /** Optional style for the list container. */
  testID?: string;
}
