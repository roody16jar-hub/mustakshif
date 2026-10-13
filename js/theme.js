// Themes change tokens only (css/tokens.css). "auto" = daylight while the sun is up in Riyadh,
// neon night otherwise. The choice is remembered per device.
import { sunTimes } from "./geo.js";

export const THEMES = [
  { id: "auto", ar: "تلقائي (نهار/ليل حسب الشمس)" },
  { id: "neon", ar: "ليل نيون" },
  { id: "day", ar: "نهار ساطع" },
  { id: "blueprint", ar: "مخطط هندسي" },
  { id: "saudi", ar: "أخضر سعودي" },
];
const KEY = "mustakshif.theme";
const RIYADH = { lat: 24.71, lon: 46.68 };
let timer = null;

export function themeChoice() { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } }
export function isDaylight(now = new Date()) {
  const { sunrise, sunset } = sunTimes(now, RIYADH.lat, RIYADH.lon);
  return now >= sunrise && now < sunset;
}
export function resolveTheme(choice = themeChoice(), now = new Date()) {
  if (choice === "auto") return isDaylight(now) ? "day" : "neon";
  return THEMES.some(t => t.id === choice) ? choice : "neon";
}
export function applyTheme(choice = themeChoice()) {
  const id = resolveTheme(choice);
  const root = document.documentElement;
  if (root.dataset.theme !== id) {
    root.dataset.theme = id;
    const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = bg || "#0a0f1e";
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: id } }));
  }
  return id;
}
export function setTheme(choice) {
  try { localStorage.setItem(KEY, choice); } catch {}
  return applyTheme(choice);
}
/** keep "auto" switching at sunrise / sunset while the app stays open */
export function startThemeClock() {
  clearInterval(timer);
  timer = setInterval(() => applyTheme(), 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) applyTheme(); });
}
/** the map palette for the current theme, read from the CSS tokens */
export function mapPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    bg: v("--map-bg"), border: v("--map-border"), borderGlow: v("--map-border-glow"), other: v("--map-other"),
    unexplored: v("--map-unexplored"), explored: v("--map-explored"), exploredGlow: v("--map-explored-glow"), faded: v("--map-faded"),
    major: v("--map-major"), me: v("--map-me"), label: v("--map-label"), labelBg: v("--map-label-bg"),
    target: v("--map-target"), visited: v("--map-visited"), ignored: v("--map-ignored"), property: v("--map-property"), sign: v("--map-sign"),
  };
}
