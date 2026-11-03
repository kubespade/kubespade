import { describe, expect, it } from 'vitest'
import { parseAzureSpJson } from './azureSp'

describe('parseAzureSpJson', () => {
  it('reads sdk-auth fields', () => {
    expect(parseAzureSpJson(JSON.stringify({
      clientId: 'c', clientSecret: 's', tenantId: 't', subscriptionId: 'sub',
    }))).toEqual({ clientId: 'c', clientSecret: 's', tenantId: 't', subscriptionId: 'sub' })
  })
  it('reads az ad sp create-for-rbac aliases', () => {
    expect(parseAzureSpJson(JSON.stringify({
      appId: 'c', password: 's', tenant: 't',
    }))).toEqual({ clientId: 'c', clientSecret: 's', tenantId: 't', subscriptionId: '' })
  })
  it('returns null for invalid json', () => {
    expect(parseAzureSpJson('not-json')).toBeNull()
  })
})
