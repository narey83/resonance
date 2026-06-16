import { apiClient } from './client';

export interface Transfer {
  id: string;
  username: string;
  direction: 'Download' | 'Upload';
  filename: string;
  size: number;
  state: string;
  stateDescription: string;
  requestedAt: string;
  enqueuedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  bytesTransferred: number;
  bytesRemaining: number;
  averageSpeed: number;
  percentComplete: number;
  placeInQueue: number | null;
  exception: string | null;
  attempts: number;
  nextAttemptAt: string | null;
}

interface DirectoryResponse {
  directory: string;
  fileCount: number;
  files: Transfer[];
}

interface UserResponse {
  username: string;
  peerAddress: string | null;
  directories: DirectoryResponse[];
}

export type TransferDir = 'download' | 'upload';

// The API returns UserResponse[] (grouped by user → directory → files).
// Flatten into a single Transfer[] for simpler consumption.
export const getAll = (dir: TransferDir): Promise<Transfer[]> =>
  apiClient
    .get<UserResponse[]>(`/transfers/${dir}s`)
    .then(r => r.data.flatMap(u => u.directories.flatMap(d => d.files)));

export const cancelTransfer = (dir: TransferDir, username: string, id: string, remove = false) =>
  apiClient.delete(
    `/transfers/${dir}s/${encodeURIComponent(username)}/${encodeURIComponent(id)}?remove=${remove}`,
  );

export const clearCompleted = (dir: TransferDir) =>
  apiClient.delete(`/transfers/${dir}s/all/completed`);
