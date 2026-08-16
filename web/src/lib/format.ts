export function money(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(
    kopecks / 100,
  );
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    active: "Активен",
    application: "Заявка",
    quarantine: "Карантин",
    week_skipped: "Пропуск",
    leave: "Ушёл",
    declined: "Отказ",
    sampler: "Пробное",
    unknown: "—",
  };
  return map[status] ?? status;
}

export const WEEKDAY_RU: Record<string, string> = {
  mon: "пн",
  tue: "вт",
  wed: "ср",
  thu: "чт",
  fri: "пт",
  sat: "сб",
  sun: "вс",
};

export function weekdaysLabel(days: string[]): string {
  return days.map((day) => WEEKDAY_RU[day] ?? day).join(" ");
}

export function telLink(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? `tel:+${digits}` : null;
}

export function waLink(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? `https://wa.me/${digits}` : null;
}

export function tgLink(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length > 0 ? `https://t.me/+${digits}` : null;
}

export function moscowToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function moscowTodayLabel(): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
}

export function initials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean);
  return (parts.slice(0, 2).join("") || "G").toUpperCase();
}

export function statusTone(status: string): "ok" | "warn" | "danger" | "accent" | "mute" {
  if (status === "active") {
    return "ok";
  }
  if (status === "application" || status === "sampler") {
    return "accent";
  }
  if (status === "quarantine" || status === "week_skipped") {
    return "warn";
  }
  if (status === "leave" || status === "declined") {
    return "mute";
  }
  return "mute";
}

export function canSeePeople(role: string): boolean {
  return role === "admin" || role === "superadmin";
}

export function canSeeStaff(role: string): boolean {
  return role === "superadmin";
}
