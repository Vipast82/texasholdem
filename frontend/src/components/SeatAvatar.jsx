import { useMemo } from 'react';
import { avatarStore } from '../services/avatarStore.js';
import { resolveAvatarView, avatarCss, cropCss } from '../services/avatarView.js';
import { useGameStore } from '../store.js';
import { t } from '../i18n.js';

/**
 * SeatAvatar — renders the correct image for a player seat, per the privacy
 * model in avatarView.js:
 *   - bot            -> generated cowboy (per difficulty)
 *   - you + uploaded -> your avatar (only you hold the binary)
 *   - anyone else    -> neutral default (we do NOT fetch other players' blobs)
 *
 * Pure decision logic lives in avatarView.js (unit-tested); this is the thin
 * DOM boundary that turns the resolved view into CSS.
 */
export default function SeatAvatar({ player, size = 44, isMe = false }) {
  // My uploaded avatar (client-side only). Bots need no binary.
  const myAvatar = useGameStore((s) => (s.avatar && s.avatar.url ? s.avatar : null));

  const view = useMemo(() => {
    // Only the avatar THIS client actually has stored is addressable.
    const avatarById =
      myAvatar && myAvatar.id ? { [myAvatar.id]: { url: myAvatar.url, crop: myAvatar.crop } } : null;
    const botSrc = (d) => avatarStore.avatarForBot(d).src;
    let resolved = resolveAvatarView(player, {
      avatarById,
      botSrc,
      defaultSrc: avatarStore.avatarForBot('normal').src
    });
    // The LOCAL player is authoritative for their own avatar: if I have an
    // uploaded image, ALWAYS show it on my own seat, regardless of whether the
    // wire `avatarMeta` round-tripped correctly. This fixes "avatar not on the
    // stick-figure head" when avatarMeta was null/stale at join time.
    if (isMe && myAvatar && myAvatar.url && !player.isBot) {
      resolved = {
        kind: 'upload',
        src: myAvatar.url,
        crop: (myAvatar.crop || null),
        avatarId: myAvatar.id
      };
    }
    return resolved;
  }, [player, myAvatar, isMe]);

  if (!view || !view.src) {
    return <div className="seatavatar seatavatar--empty" style={{ width: size, height: size }} aria-hidden="true" />;
  }

  // Uploaded avatar with a crop window: frame it with cropCss using the stored
  // source dimensions. Everything else uses the simple cover descriptor.
  const c = view.crop;
  const isCroppedUpload =
    view.kind === 'upload' && c && c.size && myAvatar && myAvatar.srcW && myAvatar.srcH;
  const style = isCroppedUpload
    ? {
        backgroundImage: `url("${view.src}")`,
        backgroundRepeat: 'no-repeat',
        ...cropCss(c, myAvatar.srcW, myAvatar.srcH)
      }
    : avatarCss(view);

  return (
    <span
      className="seatavatar"
      style={{ width: size, height: size, ...style }}
      title={player ? player.name : undefined}
      role="img"
      aria-label={
        player && player.name
          ? t('a11y.avatar', { name: player.name })
          : t('a11y.avatar.default')
      }
    />
  );
}