/** Keep credentials out of network exports and remote diagnostic messages. */
export function redactDiagnostics(value: string): string {
  return value
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, key) => {
      let decoded = key;
      try { decoded = decodeURIComponent(key); } catch { /* Preserve malformed non-secret keys. */ }
      return /^(access[_-]?token|refresh[_-]?token|token|sig|signature|api[_-]?key|password|code)$/i.test(decoded)
        ? `${separator}${key}=[redacted]` : match;
    })
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/("(?:password|accessToken|refreshToken|token|sig|x-api-key|x-resonance-link-token)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2')
    .replace(/(\/public\/mixtapes\/)[^/?#\s]+/gi, '$1[redacted]');
}
