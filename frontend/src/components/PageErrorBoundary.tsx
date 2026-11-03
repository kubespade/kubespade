import { Component, type ErrorInfo, type ReactNode } from 'react'
import { EmptyState } from './EmptyState'

interface Props {
  children: ReactNode
  /** Shown in the empty-state title (keep short). */
  label?: string
}

interface State {
  error: Error | null
}

/** Keeps the rest of the app (sidebar, chrome) up if a page throws. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.label ?? 'page', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const label = this.props.label ?? 'This page'
    return (
      <div className="res-placeholder">
        <EmptyState
          title={`${label} failed to render`}
          hint={error.message || 'Reload the page or pick another item in the sidebar.'}
          action={{
            label: 'Try again',
            onClick: () => this.setState({ error: null }),
          }}
        />
      </div>
    )
  }
}
