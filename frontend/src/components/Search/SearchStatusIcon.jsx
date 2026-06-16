import {
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  StopCircle,
  XCircle,
} from 'lucide-react';
import React from 'react';

const SearchStatusIcon = ({ size = 14, state }) => {
  switch (state) {
    case 'None':
    case 'Queued':
    case 'Requested':
      return (
        <Clock
          size={size}
          title={state}
        />
      );
    case 'InProgress':
      return (
        <Loader2
          className="sr-spin"
          size={size}
          title={state}
        />
      );
    case 'Completed, TimedOut':
    case 'Completed, ResponseLimitReached':
    case 'Completed, FileLimitReached':
      return (
        <CheckCircle2
          size={size}
          style={{ color: 'var(--color-success, #22c55e)' }}
          title={state}
        />
      );
    case 'Completed, Cancelled':
      return (
        <StopCircle
          size={size}
          title={state}
        />
      );
    case 'Completed, Errored':
      return (
        <XCircle
          size={size}
          style={{ color: 'var(--color-danger, #ef4444)' }}
          title={state}
        />
      );
    default:
      return (
        <HelpCircle
          size={size}
          style={{ color: 'var(--color-warning, #f59e0b)' }}
          title={state}
        />
      );
  }
};

export default SearchStatusIcon;
