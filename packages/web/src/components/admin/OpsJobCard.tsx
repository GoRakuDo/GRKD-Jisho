import '../../styles/globals.css';
import { StatusBadge } from './StatusBadge';
import { CodeBlock } from './CodeBlock';
import { Button } from './Button';

export type OpsJobCardProps = {
  job: {
    id: string;
    jobType: string;
    status: string;
    approvalRequired: boolean;
    argsJson: Record<string, unknown>;
    errorMessage: string | null;
    createdAt: string | null;
  };
  onApprove: (jobId: string) => void;
  onReject: (jobId: string) => void;
};

export const OpsJobCard = ({ job, onApprove, onReject }: OpsJobCardProps) => {
  const isPending = job.status.toLowerCase() === 'pending';
  const hasArgs = job.argsJson && Object.keys(job.argsJson).length > 0;

  return (
    <div className={`bg-porcelain-100 rounded-card border ${isPending ? 'border-warning-600/30 shadow-[0_0_0_1px_var(--color-warning-100)]' : 'border-graphite-180'} p-5 flex flex-col gap-4 min-h-[200px]`}>
      
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h3 className="font-grkd-sans font-semibold text-graphite-900 text-body">
            {job.jobType}
          </h3>
          <StatusBadge 
            status={job.status.toLowerCase()} 
          />
          {!job.approvalRequired && isPending && (
            <span className="font-grkd-sans text-caption bg-porcelain-150 text-graphite-650 px-2 py-1 rounded-pill border border-graphite-300">
              Auto-approve
            </span>
          )}
        </div>
        <div className="font-grkd-mono text-graphite-500 text-caption">
          {job.id}
        </div>
      </div>

      {/* Timestamp & Error */}
      <div className="flex flex-col gap-2">
        {job.createdAt && (
          <div className="font-grkd-sans text-graphite-500 text-label">
            Requested: {new Date(job.createdAt).toLocaleString()}
          </div>
        )}
        {job.errorMessage && (
          <div className="font-grkd-sans text-danger-600 text-body-sm bg-danger-100/50 p-3 rounded-md border border-danger-100">
            <strong>Error:</strong> {job.errorMessage}
          </div>
        )}
      </div>

      {/* Payload */}
      {hasArgs && (
        <div className="flex-1 mt-2">
          <div className="font-grkd-sans text-graphite-650 text-label mb-2">Arguments</div>
          <CodeBlock>
            {JSON.stringify(job.argsJson, null, 2)}
          </CodeBlock>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-graphite-180">
          <Button 
            variant="primary" 
            onClick={() => onApprove(job.id)}
          >
            Approve Job
          </Button>
          <Button 
            variant="danger" 
            onClick={() => onReject(job.id)}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
};
