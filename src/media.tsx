/**
 * Optional media helpers for `react-native-feed-pager`.
 *
 * The core `FeedPager` is media-agnostic. These helpers capture the *loading* patterns that make a
 * mixed feed feel instant — prefetch-ahead, poster-until-ready, no black flash — so you don't have to
 * re-derive them per app. They depend on `expo-image` + `expo-video` (optional peer deps): only import
 * from `react-native-feed-pager/media` if you want them.
 *
 *   import { PosterVideo, prefetchPosters } from 'react-native-feed-pager/media';
 */
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { useEffect, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Warm a set of image/poster URLs into the memory+disk cache. Call it when a cell enters the preload
 * window (e.g. for every frame of a carousel) so the media is decoded from cache instead of fresh —
 * which is what removes the black-flash-then-image pop.
 */
export function prefetchPosters(uris: ReadonlyArray<string | undefined | null>): void {
  const list = uris.filter((u): u is string => !!u);
  if (list.length > 0) void Image.prefetch(list, 'memory-disk');
}

export interface PosterVideoProps {
  /** Video source. Pass `null` to not load (far-off cells). */
  source: VideoSource | null;
  /** Poster (thumbnail) shown UNTIL the first video frame is ready. Stays painted underneath. */
  poster?: string;
  /** Play + unmute when true; pause when false. */
  active: boolean;
  /** Mount + buffer the player without playing (cells inside the preload window). */
  preload?: boolean;
  /** Global mute applied while active. */
  muted?: boolean;
  contentFit?: 'contain' | 'cover';
}

/**
 * A video that NEVER flashes black and never blips on swap. The poster `<Image>` is always mounted;
 * the `VideoView` fades in over it only once `readyToPlay`. Mount it for the active + preload cells;
 * for far cells, pass `source={null}` (the poster still shows). Because the poster never unmounts, the
 * poster→video transition has no gap to flicker through.
 */
export function PosterVideo({
  source,
  poster,
  active,
  preload = false,
  muted = true,
  contentFit = 'cover',
}: PosterVideoProps): ReactElement {
  const shouldMount = active || preload;
  const player = useVideoPlayer(shouldMount ? source : null, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const ready = status === 'readyToPlay';

  useEffect(() => {
    if (!player) return;
    if (active) {
      // eslint-disable-next-line react-hooks/immutability -- expo-video player is a mutable handle
      player.muted = muted;
      player.play();
    } else {
      // eslint-disable-next-line react-hooks/immutability -- expo-video player is a mutable handle
      player.muted = true;
      player.pause();
    }
  }, [active, muted, player]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {poster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit={contentFit} cachePolicy="memory-disk" />
      ) : null}
      {shouldMount ? (
        <VideoView
          player={player}
          style={[StyleSheet.absoluteFill, { opacity: active && ready ? 1 : 0 }]}
          contentFit={contentFit}
          nativeControls={false}
        />
      ) : null}
    </View>
  );
}
