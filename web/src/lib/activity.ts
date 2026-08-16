const ACTIVITY_KEY = "greefon-os-activity";
const BOOT_FLAG = "greefon-os-boot-once";
export const IDLE_MS = 60 * 60 * 1000;

export function touchActivity(): void {
  localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export function shouldShowBoot(): boolean {
  const last = Number(localStorage.getItem(ACTIVITY_KEY) ?? "0");
  if (!Number.isFinite(last) || last <= 0) {
    return true;
  }
  return Date.now() - last >= IDLE_MS;
}

export function markBootShown(): void {
  sessionStorage.setItem(BOOT_FLAG, "1");
  touchActivity();
}

export function bindActivityTracking(): () => void {
  const bump = () => touchActivity();
  const events = ["pointerdown", "keydown", "visibilitychange"] as const;
  for (const name of events) {
    window.addEventListener(name, bump, { passive: true });
  }
  return () => {
    for (const name of events) {
      window.removeEventListener(name, bump);
    }
  };
}
