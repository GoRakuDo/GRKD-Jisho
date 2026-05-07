import '../../styles/globals.css';
import { useState } from 'react';
import { Button } from './Button';

export type TraceSearchProps = {
  initialValue?: string;
};

export const TraceSearch = ({ initialValue = '' }: TraceSearchProps) => {
  const [value, setValue] = useState(initialValue);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (value.trim()) {
      window.location.href = `/admin/traces?traceId=${encodeURIComponent(value.trim())}`;
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-porcelain-150 rounded-panel border border-graphite-180 p-3 flex items-center gap-3 w-full max-w-2xl"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter trace ID (e.g., trc_123abc)"
        className="flex-1 bg-porcelain-50 text-graphite-900 border border-graphite-300 rounded-input h-10 px-3 font-grkd-mono text-body-sm placeholder:text-graphite-500 focus:outline-none focus:border-royal-blue-600 focus:ring-3 focus:ring-royal-blue-100 transition-shadow"
      />
      <Button type="submit" variant="primary">
        Search
      </Button>
    </form>
  );
};
