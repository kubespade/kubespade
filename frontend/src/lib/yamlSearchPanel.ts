import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import { EditorView, runScopeHandlers, type Panel } from '@codemirror/view'

function btn(className: string, title: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.title = title
  el.textContent = text
  el.addEventListener('click', onClick)
  return el
}

/** Compact find bar for the YAML editor — one row, no replace. */
export function createYamlSearchPanel(view: EditorView): Panel {
  const wrap = document.createElement('div')
  wrap.className = 'cm-search yaml-search'

  const input = document.createElement('input')
  input.type = 'search'
  input.className = 'yaml-search-input'
  input.placeholder = 'Find'
  input.setAttribute('aria-label', 'Find')
  input.setAttribute('main-field', 'true')
  input.autocomplete = 'off'
  input.spellcheck = false

  const caseBtn = btn('yaml-search-toggle', 'Match case', 'Aa', () => toggle(caseBtn))
  const reBtn = btn('yaml-search-toggle', 'Regular expression', '.*', () => toggle(reBtn))
  const wordBtn = btn('yaml-search-toggle', 'Whole word', 'W', () => toggle(wordBtn))

  function applyQuery(q: SearchQuery) {
    input.value = q.search
    caseBtn.classList.toggle('on', q.caseSensitive)
    reBtn.classList.toggle('on', q.regexp)
    wordBtn.classList.toggle('on', q.wholeWord)
  }

  function commit() {
    const next = new SearchQuery({
      search: input.value,
      caseSensitive: caseBtn.classList.contains('on'),
      regexp: reBtn.classList.contains('on'),
      wholeWord: wordBtn.classList.contains('on'),
      replace: '',
    })
    if (!next.eq(getSearchQuery(view.state))) {
      view.dispatch({ effects: setSearchQuery.of(next) })
    }
  }

  function toggle(el: HTMLButtonElement) {
    el.classList.toggle('on')
    commit()
  }

  applyQuery(getSearchQuery(view.state))
  input.addEventListener('input', commit)

  wrap.addEventListener('keydown', e => {
    if (runScopeHandlers(view, e, 'search-panel')) {
      e.preventDefault()
    } else if (e.key === 'Enter' && e.target === input) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(view)
    }
  })

  wrap.append(
    input,
    btn('yaml-search-nav', 'Previous (⇧⌘G)', '↑', () => findPrevious(view)),
    btn('yaml-search-nav', 'Next (⌘G)', '↓', () => findNext(view)),
    caseBtn,
    reBtn,
    wordBtn,
    btn('yaml-search-close', 'Close (Esc)', '×', () => closeSearchPanel(view)),
  )

  return {
    top: true,
    dom: wrap,
    mount() {
      input.select()
    },
    update(update) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(setSearchQuery)) applyQuery(effect.value)
        }
      }
    },
  }
}
