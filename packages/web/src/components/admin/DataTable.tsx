import React from 'react';
import '../../styles/globals.css';

type ColumnDef<T> = {
  key: string;
  label: string;
  width?: string;
  render?: (row: T) => React.ReactNode;
};

type DataTableProps<T extends { [key: string]: unknown }> = {
  columns: ColumnDef<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  selectedId?: string | number;
  getId: (row: T) => string | number;
  emptyMessage?: string;
};

export const DataTable = <T extends { [key: string]: unknown }>({
  columns,
  rows,
  onRowClick,
  selectedId,
  getId,
  emptyMessage = 'No data.',
}: DataTableProps<T>) => {
  return (
    <div className="bg-porcelain-100 border border-graphite-180 rounded-card overflow-hidden font-grkd-sans">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-porcelain-150 border-b border-graphite-180">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className="px-4 py-3 text-[12px] uppercase text-graphite-500 font-medium whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-graphite-650 text-[14px]">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = getId(row);
                const isSelected = selectedId === id;
                
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick && onRowClick(row)}
                    className={`
                      border-b border-graphite-180 last:border-0 relative min-h-[48px]
                      ${onRowClick ? 'cursor-pointer' : ''}
                      ${isSelected ? 'bg-royal-blue-50' : 'hover:bg-porcelain-150'}
                    `}
                  >
                    {isSelected && (
                      <td className="absolute left-0 top-0 bottom-0 w-[3px] bg-royal-blue-600 p-0 m-0" />
                    )}
                    {columns.map((col, index) => (
                      <td 
                        key={col.key} 
                        className={`px-4 py-3 text-[14px] text-graphite-900 ${index === 0 && isSelected ? 'pl-5' : ''}`}
                      >
                        {col.render ? col.render(row) : (row[col.key] as React.ReactNode)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
