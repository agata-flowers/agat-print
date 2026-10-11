interface ProxyTrustTarget {
  set(setting: "trust proxy", value: false): unknown;
}

/**
 * Client-controlled forwarding headers are never an authority boundary for the
 * API. A future trusted reverse-proxy topology must use an explicit bounded
 * proxy policy rather than enabling blanket proxy trust.
 */
export function disableProxyTrust(target: unknown): void {
  if (
    typeof target !== "function" &&
    (typeof target !== "object" || target === null)
  ) {
    throw new TypeError("HTTP adapter instance is unavailable");
  }
  const candidate = target as Partial<ProxyTrustTarget>;
  if (typeof candidate.set !== "function")
    throw new TypeError("HTTP adapter cannot enforce proxy trust policy");
  candidate.set("trust proxy", false);
}
