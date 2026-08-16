const CITY = "Санкт-Петербург";

export function mapsQuery(address: string): string | null {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withCity = /санкт|петербург|спб/i.test(trimmed) ? trimmed : `${CITY}, ${trimmed}`;
  return withCity;
}

export function yandexPlaceUrl(address: string): string | null {
  const query = mapsQuery(address);
  if (!query) {
    return null;
  }
  return `https://yandex.ru/maps/?text=${encodeURIComponent(query)}`;
}

export function yandexRouteFromHereUrl(address: string): string | null {
  const query = mapsQuery(address);
  if (!query) {
    return null;
  }
  return `https://yandex.ru/maps/?rtext=~${encodeURIComponent(query)}&rtt=auto`;
}

export function yandexRouteFromCoordsUrl(lat: number, lon: number, address: string): string | null {
  const query = mapsQuery(address);
  if (!query) {
    return null;
  }
  return `https://yandex.ru/maps/?rtext=${lat},${lon}~${encodeURIComponent(query)}&rtt=auto`;
}
