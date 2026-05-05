import '../../styles/globals.css';
import { useState, useEffect, useCallback } from 'react';
import { OpsJobCard } from './OpsJobCard';

export type OpsJobRecord = {
  id: string;
  jobType: string;
  status: string;
  approvalRequired: boolean;
  argsJson: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string | null;
};

let _csrfToken: string | null = null;
async function getCsrfToken(): Promise<string> {
  if (_csrfToken) return _csrfToken;
  const res = await fetch('/api/auth/csrf-token');
  const data = await res.json();
  _csrfToken = data.token;
  return _csrfToken!;
}

export const OpsJobsList = () => {
  const [jobs, setJobs] = useState<OpsJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/ops-jobs?filter=pending');
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch {
      setError('Failed to load pending jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleAction = async (jobId: string, action: 'approve' | 'reject') => {
    try {
      const token = await getCsrfToken();
      const res = await fetch('/api/admin/ops-jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
        },
        body: JSON.stringify({ action, jobId }),
      });
      const data = await res.json();
      if (data.success) {
        // Remove from local list immediately
        setJobs((prev) => prev.filter((j) => j.id !== jobId));
      } else {
        setError('Action failed');
      }
    } catch {
      setError('Network error');
    }
  };

  if (loading) {
    return (
      <div className="bg-porcelain-100 border border-graphite-180 rounded-card p-10 text-center text-graphite-500">
        Loading pending jobs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-danger-100 border border-danger-600 rounded-card p-10 text-center text-danger-600">
        {error}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="bg-porcelain-100 border border-graphite-180 rounded-card p-10 text-center text-graphite-500">
        No pending ops jobs. Agent requests that need approval will appear here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {jobs.map((job) => (
        <OpsJobCard
          key={job.id}
          job={job}
          onApprove={(id) => handleAction(id, 'approve')}
          onReject={(id) => handleAction(id, 'reject')}
        />
      ))}
    </div>
  );
};
