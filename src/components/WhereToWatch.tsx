"use client"
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { imageUrl, getWatchProviders } from '@/services/tmdb';
import { WatchProvider, WatchProviders } from '@/types';

// Country for availability. Browsers often list "en-US" first everywhere, so
// among the regions of the device's languages (e.g. "en-US, en-IN") prefer
// the one the device's time zone belongs to; else the first region; else US.
const deviceRegion = (): string => {
  try {
    const regions: string[] = [];
    for (const lang of navigator.languages ?? [navigator.language]) {
      const region = new Intl.Locale(lang).maximize().region;
      if (region && !regions.includes(region)) regions.push(region);
    }
    const norm = (tz: string) => tz.replace('Calcutta', 'Kolkata');
    const deviceZone = norm(Intl.DateTimeFormat().resolvedOptions().timeZone);
    for (const region of regions) {
      const locale = new Intl.Locale('und-' + region) as Intl.Locale & { getTimeZones?: () => string[]; timeZones?: string[] };
      const zones = locale.getTimeZones?.() ?? locale.timeZones ?? [];
      if (zones.map(norm).includes(deviceZone)) return region;
    }
    if (regions[0]) return regions[0];
  } catch {}
  return 'US';
};
const noopSubscribe = () => () => {};

interface WhereToWatchProps {
  mediaType: 'movie' | 'tv';
  id: number;
  className?: string;
}

// Logos of the licensed services TMDB (via JustWatch) lists for the title in
// the viewer's country: streaming first, then rental and purchase. Logos only
// (the service name is the tooltip). Loaded on its own after the title's
// details, so the page never waits for it; renders nothing while loading,
// when the request fails, or when there is no data for the country.
// The JustWatch credit is shown with the TMDB credit in the account window.
const WhereToWatch: React.FC<WhereToWatchProps> = ({ mediaType, id, className = '' }) => {
  const region = useSyncExternalStore(noopSubscribe, deviceRegion, () => null);
  const [loaded, setLoaded] = useState<{ key: string; results: Record<string, WatchProviders> } | null>(null);
  const key = `${mediaType}-${id}`;

  useEffect(() => {
    let cancelled = false;
    getWatchProviders(mediaType, id)
      .then(results => { if (!cancelled) setLoaded({ key: `${mediaType}-${id}`, results }); })
      .catch(() => {}); // availability is optional: show nothing
    return () => { cancelled = true; };
  }, [mediaType, id]);

  const local = region && loaded?.key === key ? loaded.results[region] : undefined;
  if (!region || !local) return null;

  const groups: { how: string; items?: WatchProvider[] }[] = [
    { how: 'Stream', items: [...(local.flatrate ?? []), ...(local.free ?? []), ...(local.ads ?? [])] },
    { how: 'Rent', items: local.rent },
    { how: 'Buy', items: local.buy },
  ];
  const seen = new Set<number>();
  const services = groups.flatMap(g =>
    (g.items ?? [])
      .filter(p => !seen.has(p.provider_id) && (seen.add(p.provider_id), true))
      .map(p => ({ ...p, how: g.how }))
  ).slice(0, 10);
  if (services.length === 0) return null;

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Where to watch">
      {services.map(p => (
        <img
          key={p.provider_id}
          src={imageUrl(p.logo_path)}
          alt={p.provider_name}
          title={`${p.provider_name} (${p.how})`}
          className="w-7 h-7 rounded-md object-cover border border-gray-200 dark:border-gray-700"
        />
      ))}
    </div>
  );
};

export default WhereToWatch;
