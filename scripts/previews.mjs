// Link-preview fetching: pulls Open Graph metadata for URLs found in notes.
// Runs in Node at sync time because browsers can't read other sites (CORS).
import { getPreview, upsertPreview } from './db.mjs'

const REFRESH_DAYS = 30

export function extractUrls(markdown) {
  const urls = new Set()
  for (const m of markdown.matchAll(/https?:\/\/[^\s)>\]"'`]+/g)) {
    urls.add(m[0].replace(/[.,;:!?]+$/, '')) // strip trailing punctuation
  }
  return [...urls]
}

function metaContent(html, patterns) {
  for (const p of patterns) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']|` +
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`,
      'i',
    )
    const m = html.match(re)
    if (m) return (m[1] || m[2] || '').trim()
  }
  return null
}

const decode = (s) =>
  s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ') ?? null

async function fetchMeta(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ai-notes-preview/1.0)', Accept: 'text/html' },
    })
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return {}
    const html = (await res.text()).slice(0, 300_000)
    let image = metaContent(html, ['og:image', 'twitter:image'])
    if (image) image = new URL(image, res.url).href // resolve relative image URLs
    return {
      title: decode(metaContent(html, ['og:title', 'twitter:title']) || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]),
      description: decode(metaContent(html, ['og:description', 'twitter:description', 'description'])),
      image,
      site: decode(metaContent(html, ['og:site_name'])) || new URL(res.url).hostname,
    }
  } catch {
    return {}
  } finally {
    clearTimeout(timer)
  }
}

// Returns { url: {title, description, image, site} } for every previewable URL,
// fetching only URLs that aren't cached (or whose cache is older than 30 days).
export async function buildPreviews(urls) {
  const out = {}
  for (const url of urls) {
    let row = getPreview.get(url)
    const stale = !row || Date.now() - new Date(row.fetched).getTime() > REFRESH_DAYS * 24 * 3600 * 1000
    if (stale) {
      const meta = await fetchMeta(url)
      row = {
        url,
        title: meta.title || null,
        description: meta.description || null,
        image: meta.image || null,
        site: meta.site || null,
        fetched: new Date().toISOString(),
      }
      upsertPreview.run(row)
      console.log(`  ${row.title ? '✓' : '·'} preview: ${url}`)
    }
    if (row.title) {
      out[url] = { title: row.title, description: row.description, image: row.image, site: row.site }
    }
  }
  return out
}
