const MUTED_KEY = "flip-monitor:sounds-muted";

// Persisted so a muted session stays muted across reloads.
let muted = localStorage.getItem(MUTED_KEY) === "true";

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  localStorage.setItem(MUTED_KEY, String(next));
}

// Reused elements, not a fresh `new Audio()` per call — mobile Safari only
// keeps autoplay unlocked for the specific element a gesture touched.
const SOUND_VOLUME = 0.6;
const winAudio = new Audio("/sounds/win.mp3");
const buyInAudio = new Audio("/sounds/buyin.mp3");
winAudio.volume = SOUND_VOLUME;
buyInAudio.volume = SOUND_VOLUME;

function play(audio: HTMLAudioElement) {
  if (muted) return;
  audio.currentTime = 0;
  audio.volume = SOUND_VOLUME;
  audio.play().catch((err) => console.warn(`[sounds] failed to play ${audio.src}:`, err));
}

export function playWinSound() {
  play(winAudio);
}

export function playBuyInSound() {
  play(buyInAudio);
}

// Fills arrive async over a WebSocket, not from a click, so autoplay
// policy blocks sound until these elements have played once inside a
// real gesture. `pending` avoids a race where a single tap fires both
// pointerdown and click, each starting an unlock attempt on the same
// element before the first one resolves.
const UNLOCK_EVENTS = ["pointerdown", "touchend", "keydown", "click"] as const;

export function armSoundUnlock() {
  let winUnlocked = false;
  let buyInUnlocked = false;
  let winPending = false;
  let buyInPending = false;

  const tryUnlock = (audio: HTMLAudioElement, onDone: (unlocked: boolean) => void) => {
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = SOUND_VOLUME;
        onDone(true);
      })
      .catch(() => {
        audio.volume = SOUND_VOLUME;
        onDone(false);
      });
  };

  const onInteract = () => {
    if (!winUnlocked && !winPending) {
      winPending = true;
      tryUnlock(winAudio, (unlocked) => {
        winPending = false;
        winUnlocked = unlocked;
      });
    }
    if (!buyInUnlocked && !buyInPending) {
      buyInPending = true;
      tryUnlock(buyInAudio, (unlocked) => {
        buyInPending = false;
        buyInUnlocked = unlocked;
      });
    }
    if (winUnlocked && buyInUnlocked) {
      for (const type of UNLOCK_EVENTS) document.removeEventListener(type, onInteract);
    }
  };

  for (const type of UNLOCK_EVENTS) document.addEventListener(type, onInteract);
}
