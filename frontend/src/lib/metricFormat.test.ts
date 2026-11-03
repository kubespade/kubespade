import { describe, it, expect } from 'vitest'
import {
  parseCPUMilli,
  parseMemBytes,
  fmtCPUMilli,
  fmtMemBytes,
  fmtMetric,
  fmtOverviewMetric,
} from './metricFormat'

describe('parseCPUMilli', () => {
  it.each([
    ['', 0],
    ['1000m', 1000],
    ['250m', 250],
    ['500n', 500 / 1e6],
    ['2', 2000],
    ['0.5', 500],
    ['0', 0],
  ])('parseCPUMilli(%j) === %j', (input, expected) => {
    expect(parseCPUMilli(input)).toBe(expected)
  })
})

describe('parseMemBytes', () => {
  it.each([
    ['', 0],
    ['1Ki', 1024],
    ['1Mi', 1024 ** 2],
    ['1Gi', 1024 ** 3],
    ['1Ti', 1024 ** 4],
    ['1K', 1000],
    ['1M', 1000 ** 2],
    ['1G', 1000 ** 3],
    ['1024', 1024],
    ['0', 0],
  ])('parseMemBytes(%j) === %j', (input, expected) => {
    expect(parseMemBytes(input)).toBe(expected)
  })

  it('prefers Ki over K (unit ordering)', () => {
    expect(parseMemBytes('2Ki')).toBe(2048)
    expect(parseMemBytes('2K')).toBe(2000)
  })
})

describe('fmtCPUMilli', () => {
  it.each([
    [250, '250m'],
    [999, '999m'],
    [1000, '1.00c'],
    [1500, '1.50c'],
    [0, '0m'],
  ])('fmtCPUMilli(%j) === %j', (input, expected) => {
    expect(fmtCPUMilli(input)).toBe(expected)
  })
})

describe('fmtMemBytes', () => {
  it.each([
    [512 * 1024 ** 2, '512Mi'],
    [1.5 * 1024 ** 3, '1.5Gi'],
    [1024 ** 3, '1.0Gi'],
    [2048, '2Ki'],
    [0, '0Ki'],
  ])('fmtMemBytes(%j) === %j', (input, expected) => {
    expect(fmtMemBytes(input)).toBe(expected)
  })
})

describe('fmtMetric cpu', () => {
  it.each([
    [-5, '0m'],
    [0, '0m'],
    [5, '5m'],
    [1.65, '1.65m'],
    [1650, '1.65c'],
    [1000, '1.00c'],
    [NaN, '0m'],
  ])('fmtMetric(%j, cpu) === %j', (input, expected) => {
    expect(fmtMetric(input, 'cpu')).toBe(expected)
  })

  it('rounds float noise to 2 decimals', () => {
    expect(fmtMetric(1.6500000000000001, 'cpu')).toBe('1.65m')
  })
})

describe('fmtMetric mem', () => {
  it.each([
    [1024 ** 3, '1.0Gi'],
    [1024 ** 2, '1Mi'],
    [1024, '1Ki'],
    [512, '512B'],
    [0, '0B'],
  ])('fmtMetric(%j, mem) === %j', (input, expected) => {
    expect(fmtMetric(input, 'mem')).toBe(expected)
  })
})

describe('fmtOverviewMetric', () => {
  it.each<[number, 'cpu' | 'mem', string]>([
    [2, 'cpu', '2.00c'],
    [1, 'cpu', '1.00c'],
    [0.5, 'cpu', '500m'],
    [2, 'mem', '2.00 GiB'],
    [1, 'mem', '1.00 GiB'],
    [0.5, 'mem', '512 MiB'],
  ])('fmtOverviewMetric(%j, %s) === %j', (v, field, expected) => {
    expect(fmtOverviewMetric(v, field)).toBe(expected)
  })
})
