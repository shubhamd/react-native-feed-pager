import { LegendList, type LegendListRef } from '@legendapp/list';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { Dimensions, type LayoutChangeEvent, StyleSheet, View, type ViewToken } from 'react-native';

import type { FeedPagerProps } from './types';
import { usePreloadWindow } from './use-preload-window';

const WINDOW_HEIGHT = Math.ceil(Dimensions.get('window').height);

/**
 * A full-screen vertical feed pager — TikTok / Reels / Stories style — for ANY media.
 *
 * Why Legend List + fixed item size: a full-screen pager that recycles cells and auto-measures
 * their height is prone to a recycle/measurement drift where a cell paints at the wrong offset and
 * the previous item's absolutely-positioned chrome "sticks" over the next one (a real, hard-to-kill
 * FlashList-class bug). Legend List in its default NON-recycling mode, given a FIXED item size,
 * lays every cell at exactly `index * itemHeight` and keeps each cell its own instance — which makes
 * that whole class of bug structurally impossible. This is the same primitive
 * TheWidlarzGroup/react-native-video-feed uses.
 *
 * The pager owns: deterministic snap paging (one item per swipe), active-cell tracking via
 * viewability, and an asymmetric direction-aware preload window. It is media-agnostic — your
 * `renderItem` receives `isActive` / `shouldPreload` / `height` and decides what those mean for
 * video, images, or carousels.
 */
export function FeedPager<T>(props: FeedPagerProps<T>): ReactElement {
  const {
    data,
    keyExtractor,
    renderItem,
    getItemType,
    itemHeight,
    initialIndex = 0,
    onActiveIndexChange,
    preloadAhead = 5,
    preloadBehind = 1,
    drawDistanceMultiplier = 2,
    viewabilityThreshold = 60,
    onEndReached,
    onEndReachedThreshold = 0.6,
    scrollEnabled = true,
    testID,
  } = props;

  // Cell height resolution: explicit prop wins; otherwise measure the container once; fall back to
  // the window height so the very first frame is sane. A FIXED, stable height is essential — it is
  // what makes the layout deterministic.
  const [measured, setMeasured] = useState<number | null>(itemHeight ?? null);
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (itemHeight != null) return;
      const h = Math.ceil(e.nativeEvent.layout.height);
      if (h > 0) setMeasured((cur) => (cur != null && Math.abs(cur - h) <= 1 ? cur : h));
    },
    [itemHeight],
  );
  const vh = itemHeight ?? measured ?? WINDOW_HEIGHT;
  const ready = itemHeight != null || measured != null;

  const listRef = useRef<LegendListRef>(null);
  const didSyncInitial = useRef(false);

  const { activeIndex, setActiveFromViewable, shouldPreload } = usePreloadWindow(
    preloadAhead,
    preloadBehind,
    initialIndex,
  );

  // Force the NATIVE scroll position to the opened index once the list has laid out.
  //
  // `initialScrollIndex` alone is unreliable on Android: it seeds Legend List's internal scroll *model*
  // (so its virtualized containers sit around `initialIndex`), but the underlying ScrollView's native
  // contentOffset intermittently stays at 0. The result is a blank viewport — the cell IS rendered, just
  // positioned far below where the native scroll is parked — until a user gesture re-syncs the two. (The
  // same divergence also makes viewability briefly report the top items, hijacking the active cell.)
  //
  // The model-level imperative API can't fix this: `scrollToIndex` / `scrollToOffset` see the model
  // already AT the target and no-op. So we drive the underlying ScrollView directly via
  // `getNativeScrollRef().scrollTo`, which moves the real native contentOffset regardless of the model.
  // `onLoad` fires after the initial layout (content size is established by then), and a second pass on
  // the next frame guards the rare case where the first call races content sizing. animated:false ⇒ no
  // visible jump — the pager simply appears already at the opened item.
  const onLoad = useCallback(() => {
    if (didSyncInitial.current || initialIndex <= 0) return;
    didSyncInitial.current = true;
    const target = initialIndex * vh;
    const sync = () => {
      const nativeRef = listRef.current?.getNativeScrollRef?.() as
        | { scrollTo?: (o: { x?: number; y?: number; animated?: boolean }) => void }
        | undefined;
      nativeRef?.scrollTo?.({ y: target, animated: false });
    };
    sync();
    requestAnimationFrame(sync);
  }, [initialIndex, vh]);

  const viewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: viewabilityThreshold }),
    [viewabilityThreshold],
  );
  const onViewable = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]?.index;
      setActiveFromViewable(first, data.length);
      if (first != null && data[first] != null) onActiveIndexChange?.(first, data[first]);
    },
    [setActiveFromViewable, data, onActiveIndexChange],
  );
  const viewabilityConfigCallbackPairs = useMemo(
    () => [{ viewabilityConfig, onViewableItemsChanged: onViewable }],
    [viewabilityConfig, onViewable],
  );

  // Wrap the consumer's renderItem with the computed active/preload flags. Depends on activeIndex so
  // every active-cell change re-evaluates the window across mounted cells.
  const internalRenderItem = useCallback(
    ({ item, index }: { item: T; index: number }) =>
      renderItem({ item, index, isActive: index === activeIndex, shouldPreload: shouldPreload(index), height: vh }),
    [renderItem, activeIndex, shouldPreload, vh],
  );

  // Marker that tells Legend List when to re-render its (otherwise memoized) cells. It must change on an
  // active-cell change (so isActive/shouldPreload propagate) AND whenever the consumer's `renderItem`
  // identity changes — i.e. when state it closes over (mute, optimistic save, …) updates. Keying only on
  // activeIndex would leave those cells stale: tapping mute would flip the parent's state but never
  // re-render the visible cell, so the icon (and the player) wouldn't update. `renderItem` is a stable
  // useCallback, so this only changes when it genuinely should.
  const listExtraData = useMemo(() => ({ activeIndex, renderItem }), [activeIndex, renderItem]);

  const getFixedItemSize = useCallback(() => vh, [vh]);
  const drawDistance = useMemo(() => vh * drawDistanceMultiplier, [vh, drawDistanceMultiplier]);
  // Pre-allocate enough cell containers to cover the viewport + drawDistance buffer on BOTH sides
  // (≈ 1 + 2*drawDistanceMultiplier full-screen cells). With full-screen items, Legend List's default
  // pool ratio (2) is too small, so it creates a container on demand mid-scroll — the
  // "No unused container available" warning + a scroll hitch. Sizing the pool to the buffer avoids it.
  const containerPoolRatio = useMemo(() => drawDistanceMultiplier * 2 + 2, [drawDistanceMultiplier]);

  return (
    <View style={styles.root} onLayout={onLayout} testID={testID}>
      {ready ? (
        <LegendList
          ref={listRef}
          data={data as T[]}
          keyExtractor={keyExtractor}
          renderItem={internalRenderItem}
          // Force a re-render of mounted cells when the active cell changes (isActive/shouldPreload) OR
          // the consumer's renderItem changes (mute / optimistic save). See listExtraData above.
          extraData={listExtraData}
          getItemType={getItemType}
          initialScrollIndex={initialIndex}
          // Don't paint until the initial layout (and the onLoad native-scroll sync below) is done, so the
          // viewport never flashes the pre-sync blank frame.
          waitForInitialLayout
          onLoad={onLoad}
          // Deterministic fixed-size layout — the crux of the correctness + perf story.
          estimatedItemSize={vh}
          getFixedItemSize={getFixedItemSize}
          initialContainerPoolRatio={containerPoolRatio}
          // One full item per swipe: snap to the cell grid; disableIntervalMomentum prevents flinging
          // past a single item; decelerationRate:fast tightens the settle.
          pagingEnabled
          snapToInterval={vh}
          snapToAlignment="start"
          disableIntervalMomentum
          decelerationRate="fast"
          drawDistance={drawDistance}
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator={false}
          viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
          onEndReached={onEndReached}
          onEndReachedThreshold={onEndReachedThreshold}
          bounces={false}
          overScrollMode="never"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
