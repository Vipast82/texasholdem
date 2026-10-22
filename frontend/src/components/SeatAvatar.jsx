import { useEffect, useMemo, useState } from 'react';
import { characterSvg } from '../services/characterArt.js';
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
 *
 * Sprint 7 SHARING: for ANOTHER player (a human with an avatarId that is not my
 * own), the binary does not live in my IndexedDB. The uploader POSTs it to the
 * server, so here we fetch `/avatars/:id` and render that object URL. A
 * module-level cache de-dupes + memoizes the fetch (one fetch per avatarId per
 * session). A failed/missing fetch just falls back to the default cowboy.
 */

// avatarId -> object URL, so we fetch each shared avatar at most once.
const remoteAvatarCache = new Map();
const fetchInFlight = new Map();

/** Resolve a server-shared avatar to an object URL (null when unavailable). */
function loadRemoteAvatar(id) {
  if (remoteAvatarCache.has(id)) return Promise.resolve(remoteAvatarCache.get(id));
  const base = typeof window !== 'undefined' && window.location ? window.location.origin : null;
  if (!base || typeof fetch !== 'function') {
    remoteAvatarCache.set(id, null);
    return Promise.resolve(null);
  }
  if (fetchInFlight.has(id)) return fetchInFlight.get(id);
  const url = `${base}/avatars/${encodeURIComponent(id)}`;
  const promise = fetch(url, { method: 'GET' })
    .then((res) => (res.ok ? res.blob() : null))
    .then((blob) => {
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      remoteAvatarCache.set(id, u);
      return u;
    })
    .catch(() => {
      remoteAvatarCache.set(id, null);
      return null;
    })
    .finally(() => fetchInFlight.delete(id));
  fetchInFlight.set(id, promise);
  return promise;
}

export default function SeatAvatar({ player, size = 44, isMe = false }) {
  // My uploaded avatar (client-side only). Bots need no binary.
  const myAvatar = useGameStore((s) => (s.avatar && s.avatar.url ? s.avatar : null));
  const myLook = useGameStore((s) => s.profile.look);

  // Sprint 7 SHARING: for another human with an avatarId that is NOT my own,
  // fetch the shared avatar from the server so their seat shows their image.
  const meta = player && player.avatarMeta;
  const metaId = meta && typeof meta.avatarId === 'string' ? meta.avatarId : null;
  const needsRemote = !!player && !player.isBot && !!metaId && !(isMe && myAvatar && myAvatar.id === metaId);

  // Cached URLs are read straight from the module cache; only a fresh fetch
  // needs state (to re-render once it lands).
  const [fetched, setFetched] = useState(null); // { id, url }
  useEffect(() => {
    if (!needsRemote || !metaId || remoteAvatarCache.has(metaId)) return undefined;
    let alive = true;
    loadRemoteAvatar(metaId).then((url) => {
      if (alive) setFetched({ id: metaId, url: url || null });
    });
    return () => {
      alive = false;
    };
  }, [needsRemote, metaId]);
  let remoteUrl = null;
  if (needsRemote && remoteAvatarCache.has(metaId)) remoteUrl = remoteAvatarCache.get(metaId) || null;
  else if (needsRemote && fetched && fetched.id === metaId) remoteUrl = fetched.url;

  const view = useMemo(() => {
    // Only the avatar THIS client actually has stored is addressable.
    const avatarById =
      myAvatar && myAvatar.id ? { [myAvatar.id]: { url: myAvatar.url, crop: myAvatar.crop } } : null;
    // Everyone without a picture gets their own seeded western character.
    const seed = (player && (player.name || player.id)) || 'stranger';
    const botSrc = (d) => characterSvg(seed, d);
    // A character-creator look rides along in avatarMeta; mine comes from my profile.
    const look = isMe ? myLook : meta && meta.kind === 'character' ? meta.look : null;
    let resolved = resolveAvatarView(player, {
      avatarById,
      botSrc,
      defaultSrc: characterSvg(seed, 'normal', look)
    });
    // The LOCAL player is authoritative for their own avatar: if I have an
    // uploaded image, ALWAYS show it on my own seat, regardless of whether the
    // wire `avatarMeta` round-tripped correctly.
    if (isMe && myAvatar && myAvatar.url && !player.isBot) {
      resolved = {
        kind: 'upload',
        src: myAvatar.url,
        crop: myAvatar.crop || null,
        avatarId: myAvatar.id
      };
    }
    // Sprint 7 — SHARED avatar for another player: use the fetched object URL.
    // We don't know the remote source dims, so render with a simple cover.
    if (remoteUrl && metaId && resolved.kind === 'default' && !(isMe && myAvatar && myAvatar.id === metaId)) {
      resolved = { kind: 'upload', src: remoteUrl, crop: null, avatarId: metaId };
    }
    return resolved;
  }, [player, myAvatar, myLook, meta, isMe, remoteUrl, metaId]);

  if (!view || !view.src) {
    return (
      <div
        className="seatavatar seatavatar--empty"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

  // Uploaded avatar with a crop window: frame it with cropCss using the stored
  // source dimensions. Everything else uses the simple cover descriptor.
  const c = view.crop;
  const isCroppedUpload = view.kind === 'upload' && c && c.size && myAvatar && myAvatar.srcW && myAvatar.srcH;
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
      aria-label={player && player.name ? t('a11y.avatar', { name: player.name }) : t('a11y.avatar.default')}
    />
  );
}
