// Temporary kill switch — flip back to false to re-enable. Left this way
// (rather than removing the calls) so turning sound back on later is a
// one-line change, not a re-implementation.
const SOUNDS_PAUSED = false;

// A fresh Audio() per play lets overlapping calls (e.g. two markets winning
// close together) play independently instead of cutting each other off; the
// browser caches the underlying file after the first load.
function play(src: string) {
  if (SOUNDS_PAUSED) return;
  const audio = new Audio(src);
  audio.volume = 0.6;
  // Mobile browsers can block playback outside a user gesture (autoplay
  // policy) — surface that instead of failing silently and looking
  // identical to "no event fired."
  audio.play().catch((err) => console.warn(`[sounds] failed to play ${src}:`, err));
}

export function playWinSound() {
  play("/sounds/win.mp3");
}

export function playBuyInSound() {
  play("/sounds/buyin.mp3");
}

// Fills arrive over a WebSocket at arbitrary times, never inside a click
// handler — so the very first playWinSound()/playBuyInSound() call almost
// always lands with zero user-gesture history on the page and gets
// silently dropped by autoplay policy (Safari in particular requires the
// unlocking play() to happen synchronously inside the gesture itself, not
// just "sometime after" one). Call this once at app startup: it arms a
// one-shot listener for the user's first tap/click anywhere on the page
// and uses that real gesture to play+immediately-pause both sound files at
// zero volume, which satisfies the browsers' unlock requirement so every
// later WS-triggered play() actually produces sound.
export function armSoundUnlock() {
  let armed = false;
  const unlock = () => {
    if (armed) return;
    armed = true;
    for (const src of ["/sounds/win.mp3", "/sounds/buyin.mp3"]) {
      const audio = new Audio(src);
      audio.volume = 0;
      audio
        .play()
        .then(() => audio.pause())
        .catch((err) => console.warn(`[sounds] unlock failed for ${src}:`, err));
    }
    document.removeEventListener("pointerdown", unlock);
  };
  document.addEventListener("pointerdown", unlock);
}
