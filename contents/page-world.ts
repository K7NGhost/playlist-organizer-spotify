import type { PlasmoCSConfig } from "plasmo"

// This script runs in the page's own JavaScript world (MAIN) so it can
// intercept Spotify's own fetch calls and read their response bodies.
// It can not use chrome.* APIs directly, so it bridges data to the
// isolated content script via a CustomEvent on the shared window.
export const config: PlasmoCSConfig = {
  matches: ["https://open.spotify.com/*"],
  world: "MAIN",
  run_at: "document_start"
}

const PATHFINDER = "https://api-partner.spotify.com/pathfinder/v2/query"

type RawItem = {
  uid?: string
  itemV2?: {
    data?: {
      __typename?: string
      uri?: string
      name?: string
      trackNumber?: number
    }
  }
}

type FetchContentsResponse = {
  data?: {
    playlistV2?: {
      content?: {
        items?: RawItem[]
        totalCount?: number
        pagingInfo?: { nextOffset?: number | null; limit?: number }
      }
    }
  }
}

const _nativeFetch = window.fetch.bind(window)

// Per-playlist set of offsets already dispatched — prevents double-dispatch
// when Spotify itself also fires pages as the user scrolls.
const processedOffsets = new Map<string, Set<number>>()
const lastRootFetchAt = new Map<string, number>()
function markProcessed(uri: string, offset: number): boolean {
  if (!processedOffsets.has(uri)) processedOffsets.set(uri, new Set())
  const s = processedOffsets.get(uri)!

  if (offset === 0) {
    const now = Date.now()
    const hadPriorPages = Array.from(s).some((value) => value !== 0)
    const lastSeen = lastRootFetchAt.get(uri) ?? 0

    // A new root-page fetch usually means Spotify is reloading the playlist
    // after navigation or a reorder, so stale offset bookkeeping must reset.
    if (hadPriorPages || (s.has(0) && now - lastSeen > 1500)) {
      s.clear()
    }

    lastRootFetchAt.set(uri, now)
  }

  if (s.has(offset)) return false
  s.add(offset)
  return true
}

/** Read "780 songs" text from the playlist header if the API doesn't return totalCount. */
function getTotalFromDOM(): number {
  const spans = document.querySelectorAll('[data-encore-id="text"]')
  for (const span of spans) {
    const m = span.textContent?.match(/^(\d+)\s+songs?$/i)
    if (m) return parseInt(m[1], 10)
  }
  return 0
}

function parseAndDispatch(
  json: FetchContentsResponse,
  playlistUri: string,
  offset: number,
  knownTotal: number
): { count: number; total: number } {
  const content = json?.data?.playlistV2?.content
  const items = content?.items ?? []
  const nextOffset = content?.pagingInfo?.nextOffset ?? null
  const apiTotal = content?.totalCount ?? 0
  const total = apiTotal || knownTotal

  const tracks = items
    .filter(
      (it) =>
        typeof it?.uid === "string" &&
        typeof it?.itemV2?.data?.name === "string"
    )
    .map((it) => ({
      uid: it.uid as string,
      name: it.itemV2!.data!.name as string,
      uri: it.itemV2?.data?.uri ?? "",
      id: (it.itemV2?.data?.uri ?? "").split(":").pop() ?? "",
      trackNumber: it.itemV2?.data?.trackNumber ?? 0
    }))

  console.log(
    `[SPO:page-world] dispatching ${tracks.length} tracks, offset=${offset}, complete=${nextOffset === null}, total=${total}, playlist=${playlistUri}`
  )

  window.dispatchEvent(
    new CustomEvent("__spo_tracks__", {
      detail: {
        playlistUri,
        offset,
        tracks,
        complete: nextOffset === null,
        totalCount: total || undefined
      }
    })
  )

  return { count: items.length, total }
}

window.fetch = async function (
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  const [input, init] = args

  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url ?? ""

  const rawBody = init?.body
  const isFetchContents =
    url.startsWith(PATHFINDER) &&
    typeof rawBody === "string" &&
    rawBody.includes('"fetchPlaylistContents"')

  if (isFetchContents) {
    console.log("[SPO:page-world] fetchPlaylistContents intercepted", url)
  }

  const response = await _nativeFetch(...args)

  if (isFetchContents) {
    let playlistUri = ""
    let offset = 0
    let parsedBody: unknown = null
    try {
      parsedBody = JSON.parse(rawBody as string)
      const req = parsedBody as {
        variables?: { uri?: string; offset?: number }
      }
      playlistUri = req.variables?.uri ?? ""
      offset = req.variables?.offset ?? 0
    } catch {
      // ignore parse errors
    }

    if (markProcessed(playlistUri, offset)) {
      response
        .clone()
        .json()
        .then(async (json: FetchContentsResponse) => {
          const domTotal = getTotalFromDOM()
          const { count, total } = parseAndDispatch(
            json,
            playlistUri,
            offset,
            domTotal
          )

          // After the first page, proactively fetch all remaining pages.
          // Uses _nativeFetch directly to avoid re-triggering this wrapper.
          if (
            offset === 0 &&
            total > count &&
            count > 0 &&
            parsedBody &&
            init
          ) {
            const limit = count // typically 50
            for (let nextOff = limit; nextOff < total; nextOff += limit) {
              if (!markProcessed(playlistUri, nextOff)) continue
              try {
                const newBody = JSON.stringify({
                  ...(parsedBody as object),
                  variables: {
                    ...((parsedBody as { variables?: object }).variables ?? {}),
                    offset: nextOff
                  }
                })
                const res = await _nativeFetch(PATHFINDER, {
                  ...init,
                  body: newBody
                })
                const j: FetchContentsResponse = await res.json()
                parseAndDispatch(j, playlistUri, nextOff, total)
                // Small pause to avoid hammering the API
                await new Promise<void>((r) => setTimeout(r, 80))
              } catch (err) {
                console.warn(
                  `[SPO:page-world] failed to fetch offset ${nextOff}`,
                  err
                )
              }
            }
          }
        })
        .catch(() => {
          // silently ignore JSON parse failures
        })
    }
  }

  return response
}
