import { Fragment, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { EventInfo } from '../../types'
import { formatAge } from '../../lib/formatAge'
import { TableScrollWrap } from '../../components/TableScrollWrap'

export function WarningsTable({ warnings, now }: { warnings: EventInfo[]; now: number }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  function toggle(i: number) {
    setExpandedIdx(prev => prev === i ? null : i)
  }

  return (
    <div className="ov-section">
      <div className="ov-section-title ov-section-warn">
        <AlertTriangle size={14} />
        Warnings ({warnings.length})
      </div>
      {/*
        Same pattern as resource tables:
        - TableScrollWrap: bleed + horizontal scroll when needed
        - .data-table defaults: width:auto; min-width:100% → fills the window,
          grows with content only (no fixed/100% that fights max-content parent)
        - Message max-width: long events ellipsis instead of exploding width
        - Chevron in its own column: Message header aligns with message text
      */}
      <TableScrollWrap>
        <table className="data-table ov-warn-table">
          <thead>
            <tr>
              <th className="ov-warn-th-expand" aria-hidden />
              <th>Message</th>
              <th>Object</th>
              <th>Reason</th>
              <th className="ov-warn-th-num">#</th>
              <th className="ov-warn-th-num">Age</th>
            </tr>
          </thead>
          <tbody>
            {warnings.slice(0, 25).map((e, i) => {
              const isOpen = expandedIdx === i
              return (
                <Fragment key={i}>
                  <tr
                    className={`ov-warn-row${isOpen ? ' ov-warn-row-open' : ''}`}
                    onClick={() => toggle(i)}
                  >
                    <td className="ov-warn-expand">
                      <span className="ov-expand-chevron">{isOpen ? '▾' : '▸'}</span>
                    </td>
                    <td className="ov-warn-msg" title={e.message}>{e.message}</td>
                    <td className="ov-warn-obj monospace" title={e.object}>{e.object}</td>
                    <td className="ov-warn-reason">{e.reason}</td>
                    <td className="ov-warn-num">{e.count}</td>
                    <td className="ov-warn-num ov-age">{formatAge(now, e.lastTime)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="ov-warn-detail">
                      <td colSpan={6}>
                        <div className="ov-warn-full">{e.message}</div>
                        <div className="ov-warn-meta">
                          <span>Object: <b>{e.object}</b></span>
                          <span>Reason: <b>{e.reason}</b></span>
                          <span>Count: <b>{e.count}</b></span>
                          <span>Last seen: <b>{formatAge(now, e.lastTime)} ago</b></span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </TableScrollWrap>
    </div>
  )
}
