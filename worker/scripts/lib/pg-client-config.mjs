/**
 * pg Client/Pool config for Cloud SQL.
 *
 * Topology note (QA follow-up): this is for the QA/dev path where the worker
 * reaches Cloud SQL over a PUBLIC IP with sslmode=require. pg v9 treats
 * sslmode=require as verify-full unless uselibpqcompat=true, and the
 * Google-managed server cert chain is not in the default trust store, so we
 * set rejectUnauthorized: false — traffic is encrypted but the server cert is
 * not authenticated. That is acceptable ONLY for public-IP QA.
 *
 * Production MUST use the Cloud SQL Auth Proxy or private IP (VPC peering)
 * with a proper CA, where rejectUnauthorized stays true. See
 * docs/CLOUDSQL_SECURITY.md. Do not key SSL off a hardcoded instance IP —
 * set sslmode in the connection string instead.
 */
export function pgClientConfig(connectionString) {
  if (!connectionString) return { connectionString };

  const wantsSsl = /sslmode=(require|verify-ca|verify-full|prefer)/i.test(connectionString);

  let cs = connectionString;
  if (wantsSsl && !/uselibpqcompat=/i.test(cs)) {
    cs += `${cs.includes("?") ? "&" : "?"}uselibpqcompat=true`;
  }

  return {
    connectionString: cs,
    ssl: wantsSsl ? { rejectUnauthorized: false } : undefined,
  };
}
