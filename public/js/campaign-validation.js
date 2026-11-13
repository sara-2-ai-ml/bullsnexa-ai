"use strict";

export function parseIsoCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) return null;
  return { year, month, day, epochDay: Math.floor(instant.getTime() / 86400000) };
}

export function campaignDateState(startValue, endValue, todayValue) {
  const start = parseIsoCalendarDate(startValue);
  const end = parseIsoCalendarDate(endValue);
  const today = parseIsoCalendarDate(todayValue);
  let startError = "";
  let endError = "";
  if (!startValue) startError = "Select a start date to continue.";
  else if (!start) startError = "Enter a valid start date.";
  if (!endValue) endError = "Select an end date to continue.";
  else if (!end) endError = "Enter a valid end date.";
  if (!startError && !endError && end.epochDay < start.epochDay) endError = "End date must be on or after the start date.";
  const warning = start && today && start.epochDay < today.epochDay ? "This campaign starts in the past and may require review." : "";
  const durationDays = !startError && !endError ? end.epochDay - start.epochDay + 1 : null;
  return { startError, endError, warning, durationDays };
}

export function briefFingerprint(brief) {
  return JSON.stringify(brief || {});
}
