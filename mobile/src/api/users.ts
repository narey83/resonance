import { apiClient } from './client';

export interface DirectoryFile {
  filename: string;
  size: number;
  code: number;
  extension: string;
  length: number | null;
  bitRate: number | null;
  bitDepth: number | null;
  sampleRate: number | null;
  isVariableBitRate: boolean | null;
}

export interface Directory {
  name: string;
  files: DirectoryFile[];
}

export const getDirectoryContents = (username: string, directory: string): Promise<Directory[]> =>
  apiClient
    .post<Directory[]>(`/users/${encodeURIComponent(username)}/directory`, { directory })
    .then(r => r.data);

export type UserPresence = 'Online' | 'Away' | 'Offline';

export interface UserStatus {
  presence: UserPresence;
  isPrivileged: boolean;
}

export const getUserStatus = (username: string): Promise<UserStatus> =>
  apiClient.get<UserStatus>(`/users/${encodeURIComponent(username)}/status`).then(r => r.data);

export const getUserStatuses = (usernames: string[]): Promise<Record<string, UserStatus>> =>
  apiClient.post<Record<string, UserStatus>>('/users/statuses', usernames).then(r => r.data);
