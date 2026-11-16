import { useState, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  fetcher: (page: number) => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
}

export const useInfiniteScroll = ({ fetcher, hasMore, isLoading }: UseInfiniteScrollOptions) => {
  const [page, setPage] = useState(1);
  const observer = useRef<IntersectionObserver>(null);

  // FIX: The previous implementation had a side-effect inside the `setPage` updater, which is an anti-pattern.
  // Reverted to a simpler, correct implementation that depends on the `page` state.
  const loadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      const nextPage = page + 1;
      fetcher(nextPage);
      setPage(nextPage);
    }
  }, [page, hasMore, isLoading, fetcher]);

  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading) return;
    if (observer.current) observer.current.disconnect();
    if (!hasMore) return;

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    });

    if (node) observer.current.observe(node);
  }, [isLoading, hasMore, loadMore]);

  const resetPage = useCallback(() => {
    setPage(1);
  }, []);

  return { lastElementRef, resetPage };
};
