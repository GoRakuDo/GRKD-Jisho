import React from 'react';
import { DictionaryRow } from './DictionaryRow';

interface DictionaryItem {
  id: string;
  name: string;
  slug: string;
  priority: number;
  enabled: boolean;
  entryCount: number;
}

interface DictionaryTableProps {
  dictionaries: DictionaryItem[];
  csrfToken: string;
  onUpdate: (id: string, updated: { enabled?: boolean; priority?: number }) => void;
}

export const DictionaryTable: React.FC<DictionaryTableProps> = ({
  dictionaries,
  csrfToken,
  onUpdate,
}) => {
  if (dictionaries.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={5} className="empty-state">
            No dictionaries found.
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {dictionaries.map((dict) => (
        <DictionaryRow
          key={dict.id}
          id={dict.id}
          name={dict.name}
          slug={dict.slug}
          priority={dict.priority}
          enabled={dict.enabled}
          entryCount={dict.entryCount}
          csrfToken={csrfToken}
          onUpdate={onUpdate}
        />
      ))}
    </tbody>
  );
};
