import ListState from './ListState.jsx'

// Responsive admin table.
//
//   columns: [{ key, header, render(row), nowrap?, className? }]
//     - the FIRST column's content is wrapped in a real <button> when `onRowClick` is given
//       (keyboard + screen-reader entry point); clicking anywhere on the row also works for mouse users.
//       Keep first-column render output to phrasing content (spans), since it lives inside a button.
//   rows, rowKey ('id'), onRowClick(row), rowClassName(row)
//   loading / error / onRetry / empty (text): shown through ListState when there are no rows;
//     while rows exist and `loading` is true the table fades.
//   mobile: 'cards' (default; <= 700px each row becomes a labelled card) | 'scroll'
export default function DataTable({
  columns, rows, rowKey = 'id', onRowClick, rowClassName, loading = false, error, onRetry,
  empty = 'ยังไม่มีข้อมูล', mobile = 'cards', label,
}) {
  if (!rows.length) {
    return <ListState loading={loading} error={error} onRetry={onRetry} empty={!loading && !error} emptyText={empty} />
  }
  return (
    <div className={`ad-table-wrap ad-fade${loading ? ' is-loading' : ''}`}>
      <table className={`ad-table${mobile === 'cards' ? ' ad-table--cards' : ''}`} aria-label={label} aria-busy={loading || undefined}>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col">{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              className={`${onRowClick ? 'is-clickable ' : ''}${rowClassName?.(row) || ''}`.trim() || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c, i) => (
                <td key={c.key} data-label={c.header} className={`${c.nowrap ? 'ad-nowrap ' : ''}${c.className || ''}`.trim() || undefined}>
                  {i === 0 && onRowClick ? (
                    <button
                      type="button"
                      className="ad-row-btn"
                      onClick={(e) => { e.stopPropagation(); onRowClick(row) }}
                    >
                      {c.render(row)}
                    </button>
                  ) : c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
