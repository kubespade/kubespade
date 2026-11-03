/** Namespace / resource names for the in-cluster metrics collector (v1). */
export const CMC_NAMESPACE = 'kubespade'
export const CMC_NAME = 'kubespade-metrics'
export const CMC_APP_LABEL = 'kubespade-metrics'
export const CMC_PORT = 8080

/** Per-cluster retention presets (stored in the collector). */
export const CMC_RETENTION_OPTIONS = [7, 14, 30] as const
export type CmcRetentionDays = (typeof CMC_RETENTION_OPTIONS)[number]

export const CMC_DEFAULT_RETENTION: CmcRetentionDays = 14

/**
 * Bump when collector manifests/script change and clusters need re-apply.
 * Existing installs without the annotation are treated as version 1.
 */
export const CMC_MANIFEST_VERSION = 2

export const CMC_MANIFEST_VERSION_ANN = 'kubespade/manifest-version'

export function normalizeRetentionDays(raw: number | undefined | null): CmcRetentionDays {
  if (raw != null && (CMC_RETENTION_OPTIONS as readonly number[]).includes(raw)) {
    return raw as CmcRetentionDays
  }
  return CMC_DEFAULT_RETENTION
}
