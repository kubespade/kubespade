(() => {
  const dialog = document.getElementById('lightbox')
  const img = document.getElementById('lightbox-img')
  const caption = document.getElementById('lightbox-caption')
  if (!dialog || !img || !caption) return

  function openLightbox(src, text, alt) {
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

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeLightbox()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialog.open) closeLightbox()
  })
})()
