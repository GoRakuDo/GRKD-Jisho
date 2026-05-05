import '../../styles/globals.css';
import { StatusBadge } from './StatusBadge';
import { CodeBlock } from './CodeBlock';

export type JobDetailProps = {
  job: {
    id: string;
    jobType: string;
    status: string;
    argsJson: Record<string, unknown>;
    resultJson: Record<string, unknown>;
    errorMessage: string | null;
    requestedBy: string;
    approvedBy: string | null;
    rejectedBy?: string | null;
    createdAt: string | null;
    approvedAt: string | null;
    completedAt: string | null;
    approvalRequired: boolean;
  };
};

export const JobDetailPanel = ({ job }: JobDetailProps) => {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    try {
      return new Date(dateString).toLocaleString('en-US', {
        timeZone: 'Asia/Jakarta',
      });
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
      case 'running':
        return 'border-l-warning-600';
      case 'approved':
      case 'succeeded':
        return 'border-l-success-600';
      case 'failed':
      case 'rejected':
        return 'border-l-danger-600';
      default:
        return 'border-l-graphite-500';
    }
  };

  const hasArgs = Object.keys(job.argsJson || {}).length > 0;
  const hasResult = Object.keys(job.resultJson || {}).length > 0;
  const isFinished = ['succeeded', 'failed'].includes(job.status.toLowerCase());

  return (
    <div
      className={`bg-porcelain-100 border border-graphite-180 rounded-card p-6 border-l-[3px] ${getStatusColor(
        job.status
      )}`}
    >
      <div className="flex items-center gap-4 mb-6">
        <h2 className="font-grkd-sans font-bold text-base text-graphite-800 m-0">
          {job.jobType}
        </h2>
        <StatusBadge status={job.status} />
        <span className="font-grkd-mono text-sm text-graphite-500 ml-auto">
          {job.id}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
            Requested By
          </div>
          <div className="text-sm text-graphite-650 font-grkd-sans">
            {job.requestedBy}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
            Created At
          </div>
          <div className="text-sm text-graphite-650 font-grkd-sans">
            {formatDate(job.createdAt)}
          </div>
        </div>

        {job.approvedBy && job.status.toLowerCase() !== 'rejected' && (
          <div>
            <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
              Approved By
            </div>
            <div className="text-sm text-graphite-650 font-grkd-sans">
              {job.approvedBy}
            </div>
          </div>
        )}

        {job.status.toLowerCase() === 'rejected' && (job.rejectedBy ?? job.approvedBy) && (
          <div>
            <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
              Rejected By
            </div>
            <div className="text-sm text-graphite-650 font-grkd-sans">
              {job.rejectedBy ?? job.approvedBy}
            </div>
          </div>
        )}

        {(job.approvedAt || job.completedAt) && (
          <div>
            <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
              {job.completedAt ? 'Completed At' : 'Approved At'}
            </div>
            <div className="text-sm text-graphite-650 font-grkd-sans">
              {formatDate(job.completedAt || job.approvedAt)}
            </div>
          </div>
        )}
      </div>

      {hasArgs && (
        <div className="mb-6">
          <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
            Arguments
          </div>
          <CodeBlock>
            {JSON.stringify(job.argsJson, null, 2)}
          </CodeBlock>
        </div>
      )}

      {isFinished && hasResult && (
        <div className="mb-6">
          <div className="text-xs uppercase text-graphite-500 font-medium mb-1 font-grkd-sans">
            Result
          </div>
          <CodeBlock>
            {JSON.stringify(job.resultJson, null, 2)}
          </CodeBlock>
        </div>
      )}

      {job.errorMessage && (
        <div className="bg-danger-100 border border-danger-100 rounded-md p-4 text-danger-600 font-grkd-sans text-sm">
          {job.errorMessage}
        </div>
      )}
    </div>
  );
};
