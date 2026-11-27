import { t } from "./i18n";

/** How long ago, in a few words: "5 min ago", "3 h ago", "2 days ago". */
export const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return t("minutesAgo", { count: Math.max(minutes, 1) });
  if (minutes < 60 * 24)
    return t("hoursAgo", { count: Math.round(minutes / 60) });
  return t("daysAgo", { count: Math.round(minutes / 60 / 24) });
};
