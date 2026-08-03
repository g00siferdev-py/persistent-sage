//! Open-Meteo weather helpers for Productivity mode and companion agent tools (no API key).

use serde::Serialize;
use serde_json::{json, Value};

use crate::provider::{ProviderError, ToolDefinition};

const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";

fn tool_err(msg: impl Into<String>) -> ProviderError {
    ProviderError::Api(msg.into())
}

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

fn c_to_f(c: f64) -> f64 {
    c * 9.0 / 5.0 + 32.0
}

fn kmh_to_mph(kmh: f64) -> f64 {
    kmh * 0.621_371
}

fn wmo_label(code: i64) -> &'static str {
    match code {
        0 => "Clear",
        1 | 2 => "Partly cloudy",
        3 => "Overcast",
        45 | 48 => "Fog",
        51 | 53 | 55 => "Drizzle",
        56 | 57 => "Freezing drizzle",
        61 | 63 | 65 => "Rain",
        66 | 67 => "Freezing rain",
        71 | 73 | 75 => "Snow",
        77 => "Snow grains",
        80 | 81 | 82 => "Showers",
        85 | 86 => "Snow showers",
        95 => "Thunderstorm",
        96 | 99 => "Thunderstorm with hail",
        _ => "Unknown",
    }
}

async fn http_get_json(
    http: &reqwest::Client,
    url: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    let resp = http
        .get(url)
        .query(query)
        .send()
        .await
        .map_err(|e| format!("Weather request failed: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Weather HTTP {status}: {}", clip(&body, 300)));
    }
    serde_json::from_str(&body).map_err(|e| format!("Weather JSON: {e}"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodePlace {
    pub name: String,
    pub admin1: String,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
    pub label: String,
}

async fn geocode_places(http: &reqwest::Client, query: &str) -> Result<Vec<GeocodePlace>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Enter a city or place name.".into());
    }
    let data = http_get_json(
        http,
        GEOCODE_URL,
        &[
            ("name", q.to_string()),
            ("count", "6".into()),
            ("language", "en".into()),
        ],
    )
    .await?;
    let results = data
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(results
        .iter()
        .filter_map(|r| {
            let name = r.get("name")?.as_str()?.to_string();
            let admin1 = r
                .get("admin1")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let country = r
                .get("country")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let latitude = r.get("latitude")?.as_f64()?;
            let longitude = r.get("longitude")?.as_f64()?;
            let label = [name.as_str(), admin1.as_str(), country.as_str()]
                .iter()
                .filter(|s| !s.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(", ");
            Some(GeocodePlace {
                name,
                admin1,
                country,
                latitude,
                longitude,
                label,
            })
        })
        .collect())
}

async fn forecast_at(http: &reqwest::Client, latitude: f64, longitude: f64) -> Result<Value, String> {
    if !(-90.0..=90.0).contains(&latitude) || !(-180.0..=180.0).contains(&longitude) {
        return Err("Invalid coordinates.".into());
    }
    let data = http_get_json(
        http,
        FORECAST_URL,
        &[
            ("latitude", latitude.to_string()),
            ("longitude", longitude.to_string()),
            (
                "current",
                "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m".into(),
            ),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min".into(),
            ),
            ("timezone", "auto".into()),
            ("forecast_days", "5".into()),
        ],
    )
    .await?;

    let current = data.get("current").cloned().unwrap_or(json!({}));
    let code = current
        .get("weather_code")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    let temp = current
        .get("temperature_2m")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let wind = current
        .get("wind_speed_10m")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let humidity = current
        .get("relative_humidity_2m")
        .and_then(Value::as_i64)
        .unwrap_or(0);

    let daily = data.get("daily").cloned().unwrap_or(json!({}));
    let dates = daily
        .get("time")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let codes = daily
        .get("weather_code")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let highs = daily
        .get("temperature_2m_max")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let lows = daily
        .get("temperature_2m_min")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut days = Vec::new();
    for i in 0..dates.len().min(5) {
        let d_code = codes.get(i).and_then(Value::as_i64).unwrap_or(-1);
        let high_c = highs.get(i).and_then(Value::as_f64).unwrap_or(0.0);
        let low_c = lows.get(i).and_then(Value::as_f64).unwrap_or(0.0);
        days.push(json!({
            "date": dates.get(i).and_then(Value::as_str).unwrap_or_default(),
            "weatherCode": d_code,
            "condition": wmo_label(d_code),
            "highC": high_c,
            "lowC": low_c,
            "highF": c_to_f(high_c),
            "lowF": c_to_f(low_c),
        }));
    }

    Ok(json!({
        "latitude": latitude,
        "longitude": longitude,
        "timezone": data.get("timezone").and_then(Value::as_str).unwrap_or_default(),
        "current": {
            "temperatureC": temp,
            "temperatureF": c_to_f(temp),
            "weatherCode": code,
            "condition": wmo_label(code),
            "windKmh": wind,
            "windMph": kmh_to_mph(wind),
            "humidity": humidity,
        },
        "daily": days,
    }))
}

#[tauri::command]
pub async fn weather_geocode(
    query: String,
    state: tauri::State<'_, crate::NovaState>,
) -> Result<Value, String> {
    let places = geocode_places(&state.http, &query).await?;
    Ok(json!({ "places": places }))
}

#[tauri::command]
pub async fn weather_forecast(
    latitude: f64,
    longitude: f64,
    state: tauri::State<'_, crate::NovaState>,
) -> Result<Value, String> {
    forecast_at(&state.http, latitude, longitude).await
}

// --- Companion agent tools -------------------------------------------------------

pub fn is_weather_tool_name(name: &str) -> bool {
    matches!(name, "weather_lookup" | "weather_geocode")
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "weather_lookup".into(),
            description: Some(
                "Look up current weather and a short 5-day forecast for a place (Open-Meteo). \
                 Temperatures are returned in both Celsius and Fahrenheit. Use when the user asks \
                 about weather, temperature, rain, or forecast for a city or region."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "place": {
                        "type": "string",
                        "description": "City or place name, e.g. `Boston` or `Paris, France`"
                    },
                    "latitude": { "type": "number", "description": "Optional if place is given" },
                    "longitude": { "type": "number", "description": "Optional if place is given" }
                },
                "required": []
            }),
        },
        ToolDefinition {
            name: "weather_geocode".into(),
            description: Some(
                "Resolve a place name to latitude/longitude candidates (rarely needed — prefer weather_lookup)."
                    .into(),
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "place": { "type": "string" }
                },
                "required": ["place"]
            }),
        },
    ]
}

pub async fn run_weather_tool(
    http: &reqwest::Client,
    name: &str,
    args: &Value,
) -> Result<String, ProviderError> {
    let result = match name {
        "weather_geocode" => {
            let place = args
                .get("place")
                .or_else(|| args.get("query"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let places = geocode_places(http, place)
                .await
                .map_err(tool_err)?;
            json!({ "places": places })
        }
        "weather_lookup" => {
            let lat = args.get("latitude").and_then(Value::as_f64);
            let lon = args.get("longitude").and_then(Value::as_f64);
            let (latitude, longitude, label) = if let (Some(la), Some(lo)) = (lat, lon) {
                (la, lo, format!("{la:.4},{lo:.4}"))
            } else {
                let place = args
                    .get("place")
                    .or_else(|| args.get("query"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if place.trim().is_empty() {
                    return Err(tool_err(
                        "Provide a `place` name (e.g. Boston) or latitude/longitude for weather_lookup.",
                    ));
                }
                let places = geocode_places(http, place).await.map_err(tool_err)?;
                let Some(first) = places.first() else {
                    return Err(tool_err(format!("No places found for `{place}`.")));
                };
                (first.latitude, first.longitude, first.label.clone())
            };
            let mut forecast = forecast_at(http, latitude, longitude)
                .await
                .map_err(tool_err)?;
            if let Some(obj) = forecast.as_object_mut() {
                obj.insert("place".into(), json!(label));
            }
            forecast
        }
        other => return Err(tool_err(format!("unknown weather tool: {other}"))),
    };
    serde_json::to_string(&result).map_err(|e| tool_err(e.to_string()))
}
