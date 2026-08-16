const TZ = "Europe/Moscow";

export function moscowNowContext(at = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: TZ,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
  const period =
    hour < 5 ? "ночь" : hour < 12 ? "утро" : hour < 17 ? "день" : hour < 23 ? "вечер" : "ночь";

  return [
    "Текущее время (Europe/Moscow):",
    `дата: ${parts.day} ${parts.month} ${parts.year}`,
    `день недели: ${parts.weekday}`,
    `время: ${parts.hour}:${parts.minute}`,
    `часть суток: ${period}`,
  ].join("\n");
}
