import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, MapPin, RefreshCw, Search } from "lucide-react";

type Place = {
  name: string;
  admin1: string;
  country: string;
  latitude: number;
  longitude: number;
  label: string;
};

type Forecast = {
  current: {
    temperatureC: number;
    temperatureF: number;
    weatherCode: number;
    condition: string;
    windKmh: number;
    windMph: number;
    humidity: number;
  };
  daily: Array<{
    date: string;
    weatherCode: number;
    condition: string;
    highC: number;
    lowC: number;
    highF: number;
    lowF: number;
  }>;
  timezone: string;
};

type SavedPlace = { label: string; latitude: number; longitude: number };
type TempUnit = "C" | "F";

const PLACE_KEY = "persistent-sage.productivity.weather.place";
const UNIT_KEY = "persistent-sage.productivity.weather.unit";

function loadSaved(): SavedPlace | null {
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedPlace;
  } catch {
    return null;
  }
}

function savePlace(p: SavedPlace) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function loadUnit(): TempUnit {
  try {
    const u = localStorage.getItem(UNIT_KEY);
    if (u === "C" || u === "F") return u;
  } catch {
    /* ignore */
  }
  return "F";
}

function saveUnit(u: TempUnit) {
  try {
    localStorage.setItem(UNIT_KEY, u);
  } catch {
    /* ignore */
  }
}

function toF(c: number): number {
  return (c * 9) / 5 + 32;
}

function fmtDay(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return iso;
  }
}

/** Current conditions + 5-day strip via Open-Meteo (no API key). */
export function WeatherWidget() {
  const [place, setPlace] = useState<SavedPlace | null>(() => loadSaved());
  const [unit, setUnit] = useState<TempUnit>(() => loadUnit());
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForecast = useCallback(async (p: SavedPlace) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<Forecast>("weather_forecast", {
        latitude: p.latitude,
        longitude: p.longitude,
      });
      setForecast(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (place) void loadForecast(place);
  }, [place, loadForecast]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const resp = await invoke<{ places: Place[] }>("weather_geocode", { query: q });
      setSuggestions(resp.places ?? []);
      if (!resp.places?.length) setError("No places found.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const pick = (p: Place) => {
    const saved = { label: p.label, latitude: p.latitude, longitude: p.longitude };
    savePlace(saved);
    setPlace(saved);
    setSuggestions([]);
    setQuery("");
  };

  const setTempUnit = (next: TempUnit) => {
    setUnit(next);
    saveUnit(next);
  };

  const tempNow = forecast
    ? Math.round(
        unit === "F"
          ? (forecast.current.temperatureF ?? toF(forecast.current.temperatureC))
          : forecast.current.temperatureC,
      )
    : 0;
  const wind =
    forecast == null
      ? ""
      : unit === "F"
        ? `${Math.round(forecast.current.windMph ?? forecast.current.windKmh * 0.621371)} mph`
        : `${Math.round(forecast.current.windKmh)} km/h`;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center gap-1.5">
        <form
          className="flex min-w-0 flex-1 gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="ps-input min-w-0 flex-1 px-2.5 py-1.5 text-xs"
            placeholder="City or place…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search location"
          />
          <button type="submit" className="ps-btn p-1.5" disabled={searching} aria-label="Search">
            {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          </button>
          {place ? (
            <button
              type="button"
              className="ps-btn p-1.5"
              onClick={() => void loadForecast(place)}
              disabled={loading}
              aria-label="Refresh forecast"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          ) : null}
        </form>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-ps-border" role="group" aria-label="Temperature unit">
          <button
            type="button"
            className={`px-2 py-1 text-[11px] font-medium ${unit === "F" ? "bg-ps-accent text-ps-accent-fg" : "bg-ps-elevated text-ps-muted hover:text-ps-ink"}`}
            onClick={() => setTempUnit("F")}
            aria-pressed={unit === "F"}
          >
            °F
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-[11px] font-medium ${unit === "C" ? "bg-ps-accent text-ps-accent-fg" : "bg-ps-elevated text-ps-muted hover:text-ps-ink"}`}
            onClick={() => setTempUnit("C")}
            aria-pressed={unit === "C"}
          >
            °C
          </button>
        </div>
      </div>

      {suggestions.length ? (
        <ul className="space-y-0.5 rounded-md border border-ps-border bg-ps-elevated p-1">
          {suggestions.map((p) => (
            <li key={`${p.label}-${p.latitude}`}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ps-ink hover:bg-ps-accent-soft"
                onClick={() => pick(p)}
              >
                <MapPin className="size-3 shrink-0 text-ps-accent" aria-hidden />
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-[11px] text-ps-danger">{error}</p> : null}

      {!place ? (
        <p className="text-[11px] leading-relaxed text-ps-faint">
          Search for a city to show current conditions and a short forecast. Location is saved on
          this machine only.
        </p>
      ) : null}

      {place && forecast ? (
        <div className="space-y-3">
          <div>
            <p className="ps-label flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {place.label}
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ps-ink">
              {tempNow}°
              <span className="ml-1 text-base font-normal text-ps-muted">{unit}</span>
            </p>
            <p className="text-xs text-ps-muted">{forecast.current.condition}</p>
            <p className="mt-1 text-[11px] text-ps-faint">
              Wind {wind} · Humidity {forecast.current.humidity}%
            </p>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {forecast.daily.map((d) => {
              const high = Math.round(unit === "F" ? (d.highF ?? toF(d.highC)) : d.highC);
              const low = Math.round(unit === "F" ? (d.lowF ?? toF(d.lowC)) : d.lowC);
              return (
                <div
                  key={d.date}
                  className="rounded-md border border-ps-border bg-ps-elevated px-1 py-1.5 text-center"
                >
                  <p className="text-[10px] font-medium text-ps-muted">{fmtDay(d.date)}</p>
                  <p className="mt-0.5 text-[10px] leading-tight text-ps-faint">{d.condition}</p>
                  <p className="mt-1 text-[11px] text-ps-ink">
                    {high}°
                    <span className="text-ps-faint">/{low}°</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : place && loading ? (
        <div className="flex items-center gap-2 text-xs text-ps-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Loading forecast…
        </div>
      ) : null}
    </div>
  );
}
