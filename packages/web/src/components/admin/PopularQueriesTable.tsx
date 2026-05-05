import '../../styles/globals.css';

export type PopularQueriesTableProps = {
  queries: { query: string; count: number }[];
};

export const PopularQueriesTable = ({ queries }: PopularQueriesTableProps) => {
  const topQueries = queries.slice(0, 20);

  return (
    <div className="bg-porcelain-100 rounded-card border border-graphite-180 overflow-hidden">
      <div className="bg-porcelain-150 px-4 py-3 border-b border-graphite-180">
        <h3 className="text-graphite-800 font-grkd-sans text-body-sm font-medium">Popular Queries</h3>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-porcelain-150 border-b border-graphite-180 text-graphite-500 font-grkd-sans text-label uppercase">
            <th className="px-4 py-3 font-medium w-16">Rank</th>
            <th className="px-4 py-3 font-medium">Query</th>
            <th className="px-4 py-3 font-medium text-right">Count</th>
          </tr>
        </thead>
        <tbody>
          {topQueries.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-graphite-500 font-grkd-sans">
                No queries recorded
              </td>
            </tr>
          ) : (
            topQueries.map((item, index) => (
              <tr 
                key={item.query} 
                className="border-b border-graphite-180 hover:bg-porcelain-150 last:border-0"
              >
                <td className="px-4 py-3 text-graphite-500 font-grkd-sans text-body-sm">
                  {index + 1}
                </td>
                <td className="px-4 py-3 text-graphite-800 font-grkd-mono text-body-sm">
                  {item.query}
                </td>
                <td className="px-4 py-3 text-graphite-800 font-grkd-sans text-body-sm text-right tabular-nums">
                  {item.count.toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
