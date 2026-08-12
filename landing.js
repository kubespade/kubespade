(() => {
  const dialog = document.getElementById('lightbox')
  const img = document.getElementById('lightbox-img')
  const caption = document.getElementById('lightbox-caption')

  function openLightbox(src, text, alt) {
    if (!dialog || !img || !caption) return
    img.src = src
    img.alt = alt || text || ''
    caption.textContent = text || ''
    if (typeof dialog.showModal === 'function') {
      dialog.showModal()
    } else {
      dialog.setAttribute('open', '')
    }
  }

  function closeLightbox() {
    if (!dialog || !img) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
    img.removeAttribute('src')
  }

  document.querySelectorAll('[data-lightbox]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const src = btn.getAttribute('data-lightbox')
      if (!src) return
      const text = btn.getAttribute('data-caption') || ''
      const nested = btn.querySelector('img')
      openLightbox(src, text, nested?.alt || text)
    })
  })

  if (dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeLightbox()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialog.open) closeLightbox()
    })
  }

  const tabs = document.querySelectorAll('[data-shot-platform]')
  const shots = document.querySelectorAll('[data-shot]')
  if (!tabs.length || !shots.length) return

  const shotsRoot = document.querySelector('.shots')

  function applyPlatform(platform) {
    tabs.forEach((tab) => {
      const on = tab.getAttribute('data-shot-platform') === platform
      tab.setAttribute('aria-selected', on ? 'true' : 'false')
      tab.classList.toggle('is-active', on)
    })
    if (shotsRoot) shotsRoot.setAttribute('data-platform', platform)
    shots.forEach((el) => {
      const src = el.getAttribute(`data-${platform}`)
      if (!src) return
      const btn = el.closest('[data-lightbox]') || el.querySelector('[data-lightbox]')
      const image = el.tagName === 'IMG' ? el : el.querySelector('img')
      if (image) {
        image.src = src
        const altKey = `data-alt-${platform}`
        const alt = el.getAttribute(altKey)
        if (alt) image.alt = alt
      }
      if (btn && btn.hasAttribute('data-lightbox')) {
        btn.setAttribute('data-lightbox', src)
      }
    })
  }

  if (shotsRoot && !shotsRoot.hasAttribute('data-platform')) {
    shotsRoot.setAttribute('data-platform', 'mac')
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const platform = tab.getAttribute('data-shot-platform')
      if (platform) applyPlatform(platform)
    })
  })
})()
