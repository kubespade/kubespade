import { describe, it, expect } from 'vitest'
import { profileLabel, profileLocation } from './profileLabel'
import type { Profile } from '../types'

function mkProfile(over: Partial<Profile>): Profile {
  return { name: 'id-name', clusterName: '', ...over } as Profile
}

describe('profileLabel', () => {
  it('prefers displayName', () => {
    expect(profileLabel(mkProfile({ displayName: 'Disp', clusterName: 'Clust', name: 'id' }))).toBe('Disp')
  })
  it('falls back to clusterName when displayName empty', () => {
    expect(profileLabel(mkProfile({ displayName: '', clusterName: 'Clust', name: 'id' }))).toBe('Clust')
  })
  it('falls back to name when both empty', () => {
    expect(profileLabel(mkProfile({ clusterName: '', name: 'id' }))).toBe('id')
  })
})

describe('profileLocation', () => {
  it('uses region when set', () => {
    expect(profileLocation(mkProfile({ region: 'eu-central-1' }))).toBe('eu-central-1')
  })
  it('parses EKS ARN when region empty', () => {
    expect(profileLocation(mkProfile({
      clusterName: 'arn:aws:eks:us-west-2:123:cluster/prod',
    }))).toBe('us-west-2')
  })
  it('returns null without region or arn', () => {
    expect(profileLocation(mkProfile({ clusterName: 'minikube' }))).toBeNull()
  })
})
