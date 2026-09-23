export const GOOGLE_CLIENT_ID = "482083566271-8bo7rm76hc2g2gmh7i1l97uog2k6qtv0.apps.googleusercontent.com";

export const APP_CONFIG = {
  locale: "ja-JP",
  weekStartsOn: 0,
  maxEventsPerCell: 2,
  historyLookbackDays: 365,
  historyMaxResults: 250,
};

export function hasConfiguredClientId() {
  return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith("YOUR_GOOGLE_");
}
