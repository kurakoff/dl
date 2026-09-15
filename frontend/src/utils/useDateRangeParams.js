import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

// Date range kept in the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD) so the active
// range is visible, survives reloads and can be shared as a link.
export default function useDateRangeParams(defaultDays = 28) {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get('from') || '';
  const to   = searchParams.get('to')   || '';
  const valid = DATE_RE.test(from) && DATE_RE.test(to) && from <= to;
  const startDate = valid ? from : daysAgo(defaultDays);
  const endDate   = valid ? to   : daysAgo(0);

  const setDateRange = useCallback((start, end, { replace = false } = {}) => {
    const next = new URLSearchParams(searchParams);
    next.set('from', start);
    next.set('to', end);
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  // Write the default range into the URL on first load so it is always visible
  useEffect(() => {
    if (!valid) setDateRange(startDate, endDate, { replace: true });
  }, [valid, startDate, endDate, setDateRange]);

  return [startDate, endDate, setDateRange];
}
