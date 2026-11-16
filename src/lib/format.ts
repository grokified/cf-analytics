export const fmtNum = (n: number) =>
  n < 100000
    ? n.toLocaleString('en-US')
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

export const favicon = (host: string) => `https://www.google.com/s2/favicons?domain=${host}&sz=32`

export const flag = (code: string) =>
  /^[A-Za-z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)))
    : '🏳️'

const regions = new Intl.DisplayNames(['en'], { type: 'region' })
export const countryName = (code: string) => {
  try {
    return regions.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const browsers: Record<string, string> = { MobileSafari: 'Mobile Safari', ChromeMobile: 'Chrome Mobile' }
export const browserName = (k: string) => browsers[k] ?? k

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
