import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/** Refetch when app returns to foreground (e.g. after reordering in EaAdmin). */
export function useAppFocusRefresh(onRefresh) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && onRefreshRef.current) {
        onRefreshRef.current();
      }
    });
    return () => sub.remove();
  }, []);
}
