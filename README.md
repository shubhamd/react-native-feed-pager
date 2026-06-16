# react-native-feed-pager

A high-performance, full-screen **vertical feed pager** for React Native — TikTok / Reels / Stories
style — that works with **any media**: video, images, *and* carousels. Not just video.

It owns the three things that are genuinely hard to get right in a full-screen feed:

1. **Deterministic snap paging** — exactly one full-screen item per swipe, on every gesture
   (fast flick *and* slow drag), with no "half-snap" resting between two items.
2. **Active-cell tracking** — tells you which item is centered so you can play/pause the right media.
3. **An asymmetric, direction-aware preload window** — warms the next items before the user reaches
   them so perceived load time ≈ 0, while keeping native players and memory bounded.

It is **media-agnostic**: you render the cell, the pager hands you `isActive` / `shouldPreload` /
`height` and you decide what they mean for each media type.

---

## Why it exists (the bug it kills)

A full-screen pager built on a **recycling** list (e.g. FlashList) that **auto-measures** cell heights
is prone to a nasty, intermittent bug: when a tall/odd-aspect item measures wrong mid-scroll, the
recycler mis-positions the cell. The scroll offset reads *clean* (a whole multiple of the item
height) yet the cell **paints at the wrong offset**, leaving the previous item's absolutely-positioned
chrome (caption, buttons) **stuck over the next item**. It looks like "two items on screen at once."

No snap-prop combination, `overrideItemLayout`, `useRecyclingState`, or version bump reliably fixes
it — because the root cause is *recycling + auto-measurement drift*, not snapping.

**The fix is structural:** render the feed with **Legend List** in its default **non-recycling** mode
and a **fixed item size**. Every cell is its own instance, laid out at exactly `index * itemHeight`.
The whole class of mis-positioning bug becomes impossible. This is the same primitive
[`TheWidlarzGroup/react-native-video-feed`](https://github.com/TheWidlarzGroup/react-native-video-feed)
uses; this library generalizes it to mixed media and packages it cleanly.

---

## Requirements

- React Native **New Architecture (Fabric)** — required by Legend List.
- Peer deps: `@legendapp/list >= 2.0`, `react >= 18`, `react-native >= 0.76`.

## Install

```sh
npm install react-native-feed-pager @legendapp/list
# Expo
npx expo install @legendapp/list
```

---

## Quick start

```tsx
import { FeedPager } from 'react-native-feed-pager';

<FeedPager
  data={items}
  keyExtractor={(it) => it.id}
  getItemType={(it) => it.type}            // 'video' | 'image' | 'carousel' — recycle-pool hint
  initialIndex={openedFromGridIndex}
  onActiveIndexChange={(i, item) => markSeen(item)}
  preloadAhead={5}
  preloadBehind={1}
  onEndReached={fetchNextPage}
  renderItem={({ item, isActive, shouldPreload, height }) => (
    <Cell item={item} isActive={isActive} shouldPreload={shouldPreload} height={height} />
  )}
/>
```

The pager fills its parent; give it a full-screen container (or pass an explicit `itemHeight`).

---

## Rendering each media type

`renderItem` is where the generality lives. The pager never assumes "video" — it just tells you
which cells are active and which to warm.

**Video** (`expo-video` / `react-native-video`): mount a player only when `isActive || shouldPreload`;
play+unmute when `isActive`, otherwise pause+mute; drop the source when neither.

```tsx
function VideoCell({ item, isActive, shouldPreload, height }) {
  const player = useVideoPlayer(isActive || shouldPreload ? item.url : null, (p) => { p.loop = true; });
  useEffect(() => {
    if (!player) return;
    if (isActive) { player.muted = false; player.play(); }
    else { player.muted = true; player.pause(); }
  }, [isActive, player]);
  return <View style={{ height }}><VideoView player={player} style={{ flex: 1 }} contentFit="cover" /></View>;
}
```

**Image**: `shouldPreload` warms the cache; rendering is otherwise trivial.

```tsx
function ImageCell({ item, shouldPreload, height }) {
  useEffect(() => { if (shouldPreload) Image.prefetch(item.url); }, [shouldPreload, item.url]);
  return <Image source={{ uri: item.url }} style={{ height }} contentFit="cover" />;
}
```

**Carousel**: `shouldPreload` prefetches all frames; `isActive` can enable auto-advance.

```tsx
function CarouselCell({ item, isActive, shouldPreload, height }) {
  useEffect(() => { if (shouldPreload) item.frames.forEach((f) => Image.prefetch(f.url)); }, [shouldPreload, item]);
  return <HorizontalPager frames={item.frames} autoAdvance={isActive} height={height} />;
}
```

---

## Opening at an index (the blank-on-open bug it kills)

When you open the pager deep-linked to a non-zero `initialIndex` (e.g. the user tapped tile #64 in a
grid), there's a second intermittent bug to defeat. Legend List's `initialScrollIndex` seeds its
internal scroll *model* — so its virtualized containers are placed around `initialIndex` — but on
Android the underlying native `ScrollView`'s `contentOffset` intermittently **stays at 0**. The opened
cell is rendered, just positioned far below where the native scroll is parked, so the viewport shows a
**blank screen** until a stray gesture re-syncs the two. The same model↔native divergence also makes
viewability briefly report the *top* items, which can hijack the active cell.

The model-level imperative API can't fix it: `scrollToIndex` / `scrollToOffset` see the model already
*at* the target and no-op. `FeedPager` fixes it structurally — on Legend List's `onLoad` (after the
initial layout, once content size is established) it drives the **native** `ScrollView` directly via
`getNativeScrollRef().scrollTo({ y: initialIndex * height })`, re-asserting once on the next frame to
beat any content-sizing race. `animated:false` ⇒ the pager simply appears already at the opened item,
no flash, no jump. You get correct open-at-index for free; nothing to wire up.

## How the preload window works

`usePreloadWindow(ahead, behind)` (used internally, and exported if you want it standalone) tracks the
active index and scroll **direction**, then answers "should cell `i` preload?" with an **asymmetric**
window: more cells *ahead* in the direction of travel (you're about to reach them) than *behind*.
Only active + windowed cells should hold a real player/prefetch; everything else stays a cheap
placeholder. This is what makes **Perceived TTFF ≈ 0** while capping memory/native surfaces.

Defaults (5 ahead / 1 behind) match the windows in `Slop-Social` (Mux) and `react-native-video-feed`.

---

## Optional media helpers

The core pager is media-agnostic. If you want the *loading* patterns that make a mixed feed feel
instant without re-deriving them, import from the optional `react-native-feed-pager/media` entry
(needs the optional peer deps `expo-image` + `expo-video`):

```tsx
import { PosterVideo, prefetchPosters } from 'react-native-feed-pager/media';

// In a carousel cell: warm every frame's poster when the cell enters the preload window.
useEffect(() => { if (shouldPreload) prefetchPosters(item.frames.map((f) => f.posterUrl)); }, [shouldPreload]);

// A video that never flashes black and never blips on swap: the poster stays painted underneath and
// the VideoView fades in only once readyToPlay. Mount it for active+preload cells.
<PosterVideo source={item.url} poster={item.posterUrl} active={isActive} preload={shouldPreload} muted={muted} />
```

- **`prefetchPosters(uris)`** — warms image/poster URLs into the memory+disk cache (kills the
  decode-from-scratch black flash). Call it for in-window cells (e.g. all carousel frames).
- **`PosterVideo`** — keeps the poster `<Image>` always mounted and fades the video in over it at
  `readyToPlay`. Because the poster never unmounts, the poster→video transition has no gap to flicker
  through — no black flash, no swap blip.

These are *optional*; if you only use `FeedPager` you don't pull in `expo-video`/`expo-image`.

## Props

| Prop | Default | Description |
|---|---|---|
| `data` | — | The feed items (append-safe for infinite scroll). |
| `keyExtractor` | — | Stable unique key per item (required for cell identity). |
| `renderItem` | — | `({ item, index, isActive, shouldPreload, height }) => ReactElement`. |
| `getItemType` | single bucket | Recycle-pool hint, e.g. media type. |
| `itemHeight` | measured / window | Fixed cell height. Pass to skip measurement. |
| `initialIndex` | `0` | Index to open at. |
| `onActiveIndexChange` | — | `(index, item) => void` when the centered cell changes. |
| `preloadAhead` / `preloadBehind` | `5` / `1` | Asymmetric preload window. |
| `drawDistanceMultiplier` | `2` | Render buffer = `itemHeight * this`. |
| `viewabilityThreshold` | `60` | % visible to become active. |
| `onEndReached` / `onEndReachedThreshold` | — / `0.6` | Infinite scroll. |
| `scrollEnabled` | `true` | Lock scroll (e.g. during a seek gesture). |

---

## Performance notes (what to measure)

To tune like a production feed, instrument:

- **TTFF** — preload start → first frame ready.
- **Perceived TTFF** — item becomes active → first frame ready (≈ 0 when preload is tuned).
- **FPS stability** — `requestAnimationFrame` dropped-frame detection.
- **Scroll lag** — input → frame (target ≤ 16 ms @ 60 Hz).

The fixed-size layout means scroll offsets are deterministic, so these stay stable under load.

---

## Credits & prior art

- [`TheWidlarzGroup/react-native-video-feed`](https://github.com/TheWidlarzGroup/react-native-video-feed) — Legend List + fixed-size approach this generalizes.
- [`muxinc/Slop-Social`](https://github.com/muxinc/Slop-Social) — FlashList feed with the asymmetric preload + snap config.
- [Legend List](https://github.com/LegendApp/legend-list) — the non-recycling, fixed-size list primitive.

## License

MIT
