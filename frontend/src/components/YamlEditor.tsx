import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { isLightTheme, UI_THEME_CHANGE_EVENT } from '../lib/uiTheme'
import { createYamlSearchPanel } from '../lib/yamlSearchPanel'

interface Props {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}

export function YamlEditor({ value, onChange, readOnly }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!containerRef.current) return

    const themeCompartment = new Compartment()
    const darkExt = () => (isLightTheme() ? [] : oneDark)

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        yaml(),
        search({ top: true, createPanel: createYamlSearchPanel }),
        highlightSelectionMatches(),
        themeCompartment.of(darkExt()),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        ...(readOnly ? [EditorState.readOnly.of(true)] : []),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    view.focus()

    function onThemeChange() {
      view.dispatch({ effects: themeCompartment.reconfigure(darkExt()) })
    }
    window.addEventListener(UI_THEME_CHANGE_EVENT, onThemeChange)

    return () => {
      view.destroy()
      viewRef.current = null
      window.removeEventListener(UI_THEME_CHANGE_EVENT, onThemeChange)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value changes (e.g. loading a new resource)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  return <div ref={containerRef} className="yaml-editor" />
}
