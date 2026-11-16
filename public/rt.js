// cf-analytics live visitors. Add to every page of a site:
//   <script src="https://<your-cf-analytics-worker>/rt.js" defer></script>
// Add data-site="example.com" when pages run on a subdomain of the host shown in the dashboard.
// No cookies or storage. Opens one WebSocket per visible tab and closes it a minute after the tab is hidden.
;(() => {
  const me = document.currentScript
  if (!me || navigator.webdriver) return
  const url = new URL('/api/rt', me.src)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('site', (me.dataset.site || location.hostname).replace(/^www\./, '').toLowerCase())

  let ws = null
  let ping = 0
  let hide = 0
  let delay = 1000
  let sent = location.pathname

  const connect = () => {
    let opened = false
    url.searchParams.set('p', (sent = location.pathname))
    ws = new WebSocket(url)
    ws.onopen = () => {
      opened = true
      delay = 1000
      ping = setInterval(() => ws && ws.readyState === 1 && ws.send('ping'), 30000)
    }
    ws.onclose = () => {
      clearInterval(ping)
      ws = null
      // Retry only connections that worked; a refused site (not set up in the dashboard) stays quiet.
      if (opened && !document.hidden) setTimeout(connect, (delay = Math.min(delay * 2, 30000)))
    }
  }

  const navigate = () => {
    if (location.pathname === sent || !ws || ws.readyState !== 1) return
    ws.send('p:' + (sent = location.pathname))
  }
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k]
    history[k] = function () {
      const r = orig.apply(this, arguments)
      navigate()
      return r
    }
  }
  addEventListener('popstate', navigate)

  document.addEventListener('visibilitychange', () => {
    clearTimeout(hide)
    if (document.hidden) hide = setTimeout(() => ws && ws.close(), 60000)
    else if (!ws) connect()
  })
  if (!document.hidden) connect()
})()
