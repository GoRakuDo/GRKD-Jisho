import '../../styles/globals.css';
import { useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { CodeBlock } from './CodeBlock';

export type TraceEvent = {
  id: string;
  eventType: string;
  level: string;
  createdAt: string | null;
  payloadJson: Record<string, unknown>;
};

export type TraceTimelineProps = {
  events: TraceEvent[];
  traceId: string;
};

export const TraceTimeline = ({ events, traceId }: TraceTimelineProps) => {
  return (
    <div className="bg-porcelain-100 rounded-card border border-graphite-180 p-6">
      <div className="mb-6 pb-4 border-b border-graphite-180">
        <h3 className="text-graphite-800 font-grkd-sans text-body-sm font-medium mb-1">Trace Details</h3>
        <p className="font-grkd-mono text-graphite-800 text-label">
          {traceId}
        </p>
      </div>

      {events.length === 0 ? (
        <div className="text-graphite-500 font-grkd-sans text-body-sm text-center py-8">
          No events found for this trace.
        </div>
      ) : (
        <div className="relative pl-6 border-l border-graphite-300 ml-4 space-y-8">
          {events.map((event) => (
            <TimelineEvent key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
};

const TimelineEvent = ({ event }: { event: TraceEvent }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-danger-600';
      case 'warn':
      case 'warning':
        return 'text-warning-600';
      default:
        return 'text-graphite-650';
    }
  };

  const hasPayload = event.payloadJson && Object.keys(event.payloadJson).length > 0;

  return (
    <div className="relative">
      {/* Node indicator */}
      <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full bg-trace-violet-600 border border-porcelain-100" />
      
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-grkd-mono text-graphite-500 text-caption">
            {event.createdAt ? new Date(event.createdAt).toISOString() : 'Unknown time'}
          </span>
          <StatusBadge 
            status={event.level.toLowerCase()} 
          />
          <span className={`font-grkd-sans text-body-sm font-medium ${getLevelColor(event.level)}`}>
            {event.eventType}
          </span>
        </div>

        {hasPayload && (
          <div className="mt-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-graphite-500 hover:text-royal-blue-600 font-grkd-sans text-label flex items-center gap-1 transition-colors"
            >
              {isExpanded ? '▼ Hide payload' : '▶ Show payload'}
            </button>
            
            {isExpanded && (
              <div className="mt-2">
                <CodeBlock>
                  {JSON.stringify(event.payloadJson, null, 2)}
                </CodeBlock>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
