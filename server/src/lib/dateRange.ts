export type DateBoundary = 'start' | 'end';

function isDateOnlyInput(value: string): boolean {
  return !value.toLowerCase().includes('t');
}

export function parseDateBoundary(raw: string, boundary: DateBoundary): Date {
  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    throw new Error(boundary === 'start' ? 'Invalid start date' : 'Invalid end date');
  }

  if (isDateOnlyInput(raw)) {
    if (boundary === 'start') {
      date.setUTCHours(0, 0, 0, 0);
    } else {
      date.setUTCHours(23, 59, 59, 999);
    }
  }

  return date;
}
