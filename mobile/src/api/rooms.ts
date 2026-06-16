import { apiClient } from './client';

export interface RoomInfo {
  name: string;
  userCount: number;
  isPrivate: boolean;
  isOwned: boolean;
  isModerated: boolean;
}

export interface RoomUser {
  username: string;
  averageSpeed: number;
  countryCode: string | null;
  directoryCount: number;
  fileCount: number;
  slotsFree: boolean;
  status: number;
  uploadCount: number;
  self?: boolean;
}

export interface RoomMessage {
  roomName: string;
  username: string;
  message: string;
  timestamp: string;
  self?: boolean;
}

export interface Room {
  name: string;
  isPrivate: boolean;
  owner: string | null;
  operatorCount: number | null;
  operators: string[];
  users: RoomUser[];
  messages: RoomMessage[];
}

export const getAvailable = () =>
  apiClient.get<RoomInfo[]>('/rooms/available').then(r => r.data);

export const getJoinedNames = () =>
  apiClient.get<string[]>('/rooms/joined').then(r => r.data);

export const getRoom = (roomName: string) =>
  apiClient.get<Room>(`/rooms/joined/${encodeURIComponent(roomName)}`).then(r => r.data);

export const getMessages = (roomName: string) =>
  apiClient.get<RoomMessage[]>(`/rooms/joined/${encodeURIComponent(roomName)}/messages`).then(r => r.data);

export const join = (roomName: string) =>
  apiClient.post('/rooms/joined', JSON.stringify(roomName), {
    headers: { 'Content-Type': 'application/json' },
  });

export const leave = (roomName: string) =>
  apiClient.delete(`/rooms/joined/${encodeURIComponent(roomName)}`);

export const sendMessage = (roomName: string, message: string) =>
  apiClient.post(`/rooms/joined/${encodeURIComponent(roomName)}/messages`, JSON.stringify(message), {
    headers: { 'Content-Type': 'application/json' },
  });
