import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function SecretInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="secret-input-wrap">
      <input
        {...props}
        className={`acm-input secret-input${className ? ` ${className}` : ''}`}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        className="secret-input-toggle"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide secret' : 'Show secret'}
        title={visible ? 'Hide' : 'Show'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}
