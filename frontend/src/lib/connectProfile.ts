import {
  api,
  NeedsInsecureTLSError,
  NeedsMFAError,
} from '../api/client'
import { isInvalidMfaMessage } from './mfaPrompt'
import type { EKSCluster, Profile } from '../types'

export type ConnectResult =
  | { status: 'connected' }
  | { status: 'mfa'; message?: string }
  | { status: 'pick-cluster'; clusters: EKSCluster[] }
  | { status: 'error'; message: string }

export { isInvalidMfaMessage }

async function authWithSafety(
  profile: Profile,
  clusterName: string,
  mfaToken: string,
  resourceGroup?: string,
): Promise<void> {
  let allowInsecureTLS = false
  for (;;) {
    try {
      await api.authProfile(profile.name, clusterName, mfaToken, resourceGroup, {
        allowExec: true,
        allowInsecureTLS,
      })
      return
    } catch (e) {
      if (e instanceof NeedsInsecureTLSError) {
        const ok = window.confirm(
          `This kubeconfig disables TLS verification` +
            (e.server ? ` for ${e.server}` : '') +
            `.\n\nConnect anyway?`,
        )
        if (!ok) throw new Error('Insecure TLS cancelled')
        allowInsecureTLS = true
        continue
      }
      throw e
    }
  }
}

export async function authProfileSafe(
  profileName: string,
  clusterName: string,
  mfaToken = '',
  resourceGroup?: string,
): Promise<void> {
  await authWithSafety(
    { name: profileName, resourceGroup } as Profile,
    clusterName,
    mfaToken,
    resourceGroup,
  )
}

/** Connect a profile. Skips auth if already connected (except live-linked kubeconfig). */
export async function connectProfile(profile: Profile, mfaToken = ''): Promise<ConnectResult> {
  const liveKubeconfig = profile.type === 'kubeconfig' && !!profile.kubeconfigPath
  if (profile.connected && !liveKubeconfig) return { status: 'connected' }

  try {
    if (profile.clusterName) {
      await authWithSafety(profile, profile.clusterName, mfaToken, profile.resourceGroup)
      return { status: 'connected' }
    }
    const { clusters } = await api.listClusters(profile.name, mfaToken)
    if (clusters.length === 1) {
      await authWithSafety(profile, clusters[0].name, mfaToken, clusters[0].resourceGroup)
      return { status: 'connected' }
    }
    return { status: 'pick-cluster', clusters }
  } catch (e) {
    if (e instanceof NeedsMFAError) return { status: 'mfa' }
    const message = e instanceof Error ? e.message : 'Connection failed'
    // Wrong OTP — keep the MFA UI open so the user can retry without restarting.
    if (mfaToken && isInvalidMfaMessage(message)) return { status: 'mfa', message }
    return { status: 'error', message }
  }
}
