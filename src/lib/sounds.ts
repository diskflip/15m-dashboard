// Flip back to false to re-enable.
const SOUNDS_PAUSED = false;

function play(src: string) {
  if (SOUNDS_PAUSED) return;
  const audio = new Audio(src);
  audio.volume = 0.6;
  audio.play().catch((err) => console.warn(`[sounds] failed to play ${src}:`, err));
}

export function playWinSound() {
  play("/sounds/win.mp3");
}

export function playBuyInSound() {
  play("/sounds/buyin.mp3");
}

// Fills arrive over a WebSocket at arbitrary times, never inside a click
// handler, so autoplay policy silently blocks the first real sound unless a
// real user gesture has unlocked it first. Call once at startup: arms a
// one-shot listener that plays+immediately-pauses both files at zero volume
// on the user's first tap.
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
