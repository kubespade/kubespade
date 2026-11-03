export type AzureSpFields = {
  clientId: string
  clientSecret: string
  tenantId: string
  subscriptionId: string
}

/** Parse Azure service-principal JSON (`az ad sp create-for-rbac` / `--sdk-auth`). */
export function parseAzureSpJson(raw: string): AzureSpFields | null {
  try {
    const sp = JSON.parse(raw) as Record<string, unknown>
    const str = (...keys: string[]) => {
      for (const k of keys) {
        const v = sp[k]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
    const fields: AzureSpFields = {
      clientId: str('clientId', 'appId'),
      clientSecret: str('clientSecret', 'password'),
      tenantId: str('tenantId', 'tenant'),
      subscriptionId: str('subscriptionId'),
    }
    if (!fields.clientId && !fields.clientSecret && !fields.tenantId && !fields.subscriptionId) {
      return null
    }
    return fields
  } catch {
    return null
  }
}
