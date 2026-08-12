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

  function visibleShotImg(btn) {
    const images = [...btn.querySelectorAll('img.shot-img, img')]
    return images.find((el) => {
      const style = window.getComputedStyle(el)
      return style.display !== 'none' && style.visibility !== 'hidden'
    }) || images[0] || null
  }

  function syncLightboxSources() {
    document.querySelectorAll('.shots-section [data-lightbox]').forEach((btn) => {
      const visible = visibleShotImg(btn)
      if (visible?.src) btn.setAttribute('data-lightbox', visible.getAttribute('src') || visible.src)
    })
  }

  document.querySelectorAll('[data-lightbox]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const visible = visibleShotImg(btn)
      const src = visible?.getAttribute('src') || btn.getAttribute('data-lightbox')
      if (!src) return
      const text = btn.getAttribute('data-caption') || ''
      openLightbox(src, text, visible?.alt || text)
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

  // Platform radios are CSS-driven; keep lightbox paths in sync when they change.
  document.querySelectorAll('input[name="shot-platform"]').forEach((input) => {
    input.addEventListener('change', syncLightboxSources)
  })
  syncLightboxSources()
})()
