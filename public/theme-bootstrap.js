// Apply the saved theme before first paint to avoid a flash.
try {
  const theme = localStorage.getItem('sift:theme') || ''
  document.documentElement.dataset.theme = theme.includes('light') ? 'light' : 'dark'
} catch {}
