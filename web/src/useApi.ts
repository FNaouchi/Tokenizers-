import { useEffect, useState } from 'react';
import { ApiError } from './api';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Runs an API call whenever its dependencies change, ignoring results from outdated calls. */
export function useApi<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, error: null, loading: true }));
    load(controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof ApiError && err.problems.length > 0
            ? `${err.message} ${err.problems.join(' ')}`
            : err instanceof Error
              ? err.message
              : 'Something went wrong.';
        setState({ data: null, error: message, loading: false });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
