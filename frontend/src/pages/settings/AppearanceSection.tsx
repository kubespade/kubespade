import { Monitor } from 'lucide-react'
import { UI_DENSITY_OPTIONS, type UiDensity } from '../../lib/uiDensity'
import { UI_THEME_OPTIONS, type UiTheme } from '../../lib/uiTheme'

const SCALE_PRESETS = [
  { label: 'S', value: 0.9, title: 'Small' },
  { label: 'M', value: 1.0, title: 'Default' },
  { label: 'L', value: 1.15, title: 'Large' },
  { label: 'XL', value: 1.3, title: 'Extra Large' },
]

interface Props {
  uiScale: number
  onScaleChange: (v: number) => void
  uiDensity: UiDensity
  onDensityChange: (v: UiDensity) => void
  uiTheme: UiTheme
  onThemeChange: (v: UiTheme) => void
}

export function AppearanceSection({
  uiScale, onScaleChange, uiDensity, onDensityChange, uiTheme, onThemeChange,
}: Props) {
  return (
    <div className="settings-panel-section">
      <div className="settings-section-title">
        <Monitor size={12} />
        Appearance
      </div>

      <div className="settings-row">
        <div className="settings-row-info">
          <span className="settings-row-label">Theme</span>
          <span className="settings-row-desc">Day and Night override the system look; System follows macOS</span>
        </div>
        <div className="settings-row-control">
          <div className="settings-scale-presets" role="group" aria-label="Theme">
            {UI_THEME_OPTIONS.map(p => (
              <button
                key={p.id}
                type="button"
                className={`settings-scale-preset${uiTheme === p.id ? ' active' : ''}`}
                onClick={() => onThemeChange(p.id)}
                title={p.title}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-info">
          <span className="settings-row-label">Interface Scale</span>
          <span className="settings-row-desc">Scales text, icons and spacing across the entire UI</span>
        </div>
        <div className="settings-row-control">
          <div className="settings-scale-presets">
            {SCALE_PRESETS.map(p => (
              <button
                key={p.value}
                className={`settings-scale-preset ${Math.abs(uiScale - p.value) < 0.01 ? 'active' : ''}`}
                onClick={() => onScaleChange(p.value)}
                title={p.title}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="settings-scale-slider-row">
            <span className="settings-scale-a small">A</span>
            <input
              type="range"
              className="settings-slider"
              min={0.8}
              max={1.4}
              step={0.05}
              value={uiScale}
              onChange={e => onScaleChange(Number(e.target.value))}
            />
            <span className="settings-scale-a large">A</span>
            <span className="settings-scale-pct">{Math.round(uiScale * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-info">
          <span className="settings-row-label">Density</span>
          <span className="settings-row-desc">Row padding in tables, sidebar, and cluster cards — separate from Scale</span>
        </div>
        <div className="settings-row-control">
          <div className="settings-scale-presets" role="group" aria-label="Density">
            {UI_DENSITY_OPTIONS.map(p => (
              <button
                key={p.id}
                type="button"
                className={`settings-scale-preset settings-density-preset${uiDensity === p.id ? ' active' : ''}`}
                onClick={() => onDensityChange(p.id)}
                title={p.title}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
