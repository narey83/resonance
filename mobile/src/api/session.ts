import axios from 'axios';

// camelCase matches the backend's default ASP.NET Core JSON output — do NOT change to PascalCase
export interface TokenResponse {
  token:        string;
  refreshToken: string;
  expires:      number;
  name:         string;
  sessionId?:   string;
}

export const login = async (
  serverUrl: string,
  username: string,
  password: string,
  deviceName: string,
  existingSessionId?: string | null,
): Promise<TokenResponse> => {
  const { data } = await axios.post<TokenResponse>(
    `${serverUrl}/api/v0/session`,
    { username, password, deviceName, existingSessionId },
    { timeout: 10000 },
  );
  return data;
};

export const checkInitialized = async (serverUrl: string): Promise<boolean> => {
  const { data } = await axios.get<boolean>(
    `${serverUrl}/api/v0/session/initialized`,
    { timeout: 8000 },
  );
  return data;
};

export const logout = async (refreshToken: string): Promise<void> => {
  const { apiClient } = await import('./client');
  await apiClient.delete('/session', { data: { refreshToken } });
};
