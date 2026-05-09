import React from 'react';

interface DictionaryHit {
  dictionaryId: number | null;
  dictionaryName: string | null;
  hitCount: number;
}

interface DictionaryHitsUIProps {
  hits: DictionaryHit[];
}

export const DictionaryHitsUI: React.FC<DictionaryHitsUIProps> = ({ hits }) => {
  if (hits.length === 0) {
    return <p className="panel-empty">No dictionary hit data in the last 7 days.</p>;
  }

  const maxHit = hits[0]?.hitCount ?? 1;

  return (
    <div className="dictionary-hits-list">
      {hits.map((hit, idx) => {
        const percentage = maxHit > 0 ? (hit.hitCount / maxHit) * 100 : 0;
        return (
          <div key={`${hit.dictionaryId ?? 'null'}-${idx}`} className="dictionary-hit-row">
            <span className="hit-rank">{idx + 1}</span>
            <span className="hit-name" title={String(hit.dictionaryId ?? 0)}>
              {hit.dictionaryName ?? hit.dictionaryId}
            </span>
            <div className="hit-bar-container">
              <div
                className="hit-bar"
                style={{ width: `${Math.max(percentage, 5)}%` }}
              />
            </div>
            <span className="hit-count">{hit.hitCount.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
};
