import { useEffect, useRef, useState } from 'react'

// Debounces `value` -- used to hold off refetching a paginated list until
// typing in its search box pauses, instead of firing one request per
// keystroke.
function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// Drives a server-paginated admin list (PlacesTab/EventsTab/KnowledgeTab/
// QrTab's rewards section): owns page + search-box state, refetches
// `fetchFn` on page/search/sort change, and resets to page 1 whenever the
// search term or `extraParams` (e.g. a sort dropdown) change -- staying on
// e.g. page 3 of a now-shorter result set would render an empty page.
//
// `fetchFn` must be one of apiClient.js's paginated list fetchers (called
// with `{ page, limit, search, ...extraParams }`), returning crudRouter.js's
// `{ data, total }` shape.
//
// After a create/update/delete, callers should call `refetch()` to re-pull
// the current page rather than trying to patch `rows` by hand -- the admin
// tabs' mutations go through AppContext's actions, which for events also
// update the separate bulk `state.events` array (used elsewhere, e.g.
// EventDetailPage), not this hook's own paginated `rows`. Places has no
// such bulk array anymore (see AppContext.jsx's loadData).
export function usePagedList(fetchFn, { pageSize = 20, extraParams } = {}) {
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 300)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const requestId = useRef(0)
  const extraKey = JSON.stringify(extraParams)

  useEffect(() => { setPage(1) }, [debouncedQuery, extraKey])

  // Without this, clicking a page number that's below the fold (the pager
  // sits at the bottom of the grid) swaps the grid's content off-screen --
  // nothing in the visible viewport changes, so it reads as "did that even
  // do anything?" even though the new page did load.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [page])

  useEffect(() => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    fetchFn({ page, limit: pageSize, search: debouncedQuery || undefined, ...extraParams })
      .then(({ data, total: t }) => {
        if (id !== requestId.current) return // a newer request already landed
        setRows(data)
        setTotal(t)
      })
      .catch((err) => { if (id === requestId.current) setError(err) })
      .finally(() => { if (id === requestId.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQuery, extraKey, pageSize, refreshTick])

  return {
    rows, total, page, setPage, pageSize, loading, error,
    query, setQuery,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    refetch: () => setRefreshTick((t) => t + 1),
  }
}
