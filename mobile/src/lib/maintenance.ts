/** Recognize only the explicit proxy contract, never an arbitrary 503 outage. */
export function isMaintenanceResponse(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const value = response as { status?: number; headers?: Record<string, unknown>; data?: { code?: string } };
  return value.status === 503 && (value.headers?.['x-resonance-maintenance'] === 'true' || value.data?.code === 'maintenance');
}
