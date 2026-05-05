import '../../styles/globals.css';
import { MetricCard } from './MetricCard';

export type LogsSummaryProps = {
  totalLookups: number;
  cacheHitRatio: string;
  errors: number;
  warns: number;
  periodDays: number;
};

export const LogsSummary = ({
  totalLookups,
  cacheHitRatio,
  errors,
  warns,
  periodDays,
}: LogsSummaryProps) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <MetricCard
        label={`Lookups (${periodDays}d)`}
        value={totalLookups.toLocaleString()}
      />
      <MetricCard
        label="Cache Hit Ratio"
        value={`${cacheHitRatio}%`}
      />
      <MetricCard
        label="Errors"
        value={errors.toLocaleString()}
        className={errors > 0 ? 'text-danger-600' : ''}
      />
      <MetricCard
        label="Warnings"
        value={warns.toLocaleString()}
        className={warns > 0 ? 'text-warning-600' : ''}
      />
    </div>
  );
};
