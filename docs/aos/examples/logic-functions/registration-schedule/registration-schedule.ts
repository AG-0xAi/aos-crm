// CRM-035 example CODE step: "Programar serie" send dates.
//
// Given when a person registered and a list of day offsets, returns one
// UTC instant per offset: 09:00 Europe/Madrid on (registration day + offset
// days), correct across the March/October DST changes. No network, no
// dependencies, no secrets -- only Intl.DateTimeFormat and date arithmetic.

const MADRID_TIME_ZONE = 'Europe/Madrid';
const SEND_HOUR_LOCAL = 9;
const SEND_MINUTE_LOCAL = 0;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

type DateParts = { year: number; month: number; day: number };

// Minutes to add to a UTC instant to get local wall-clock time in `timeZone`
// at that same instant (e.g. +60 for CET, +120 for CEST).
const getTimeZoneOffsetMinutes = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return (asUtcMs - date.getTime()) / MS_PER_MINUTE;
};

const getDatePartsInTimeZone = (date: Date, timeZone: string): DateParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
};

const addCalendarDays = (parts: DateParts, days: number): DateParts => {
  const shiftedMs =
    Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY;
  const shifted = new Date(shiftedMs);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

// `hour`:`minute` local wall-clock time on `parts`' calendar day, in
// `timeZone`, expressed as a UTC ISO string. A single offset lookup at the
// naive guess (treating the wall-clock time as if it were already UTC) is
// enough: Europe's DST transitions happen at 01:00-03:00 local time, and
// 09:00 local is never inside that window, so the guessed instant always
// falls on the correct side of any transition on that calendar day.
const localTimeToUtcIso = (
  parts: DateParts,
  hour: number,
  minute: number,
  timeZone: string,
): string => {
  const guessUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    0,
  );
  const offsetMinutes = getTimeZoneOffsetMinutes(
    new Date(guessUtcMs),
    timeZone,
  );
  const actualUtcMs = guessUtcMs - offsetMinutes * MS_PER_MINUTE;

  return new Date(actualUtcMs).toISOString();
};

export const main = async (params: {
  registeredAt: string;
  offsetsDays: number[];
}): Promise<{ sendAt: string[] }> => {
  const { registeredAt, offsetsDays } = params;
  const registrationDateParts = getDatePartsInTimeZone(
    new Date(registeredAt),
    MADRID_TIME_ZONE,
  );

  const sendAt = offsetsDays.map((offsetDays) => {
    const targetDateParts = addCalendarDays(registrationDateParts, offsetDays);

    return localTimeToUtcIso(
      targetDateParts,
      SEND_HOUR_LOCAL,
      SEND_MINUTE_LOCAL,
      MADRID_TIME_ZONE,
    );
  });

  return { sendAt };
};
