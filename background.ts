type TrackContext = {
  playlistId: string
  playlistLength: number
  trackName: string
  trackId: string
  rowIndex: number
}

type TrackItem = {
  position: number
  name: string
  id: string
  uri: string
}

type SpotifyTracksPage = {
  items: Array<{ track?: { id: string; name: string; uri: string } }>
  next: string | null
}

type SpotifyErrorBody = {
  error?: { message?: string }
}

const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9]+$/
const TRACK_ID_PATTERN = /^[A-Za-z0-9]+$/
const ALLOWED_MOVE_TO = new Set(["top", "middle", "bottom", "index"] as const)

function isFiniteNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isValidTrackContext(value: unknown): value is TrackContext {
  if (!value || typeof value !== "object") {
    return false
  }

  const context = value as TrackContext

  return (
    typeof context.playlistId === "string" &&
    PLAYLIST_ID_PATTERN.test(context.playlistId) &&
    typeof context.trackId === "string" &&
    TRACK_ID_PATTERN.test(context.trackId) &&
    typeof context.trackName === "string" &&
    context.trackName.length > 0 &&
    context.trackName.length <= 500 &&
    isFiniteNonNegativeInteger(context.playlistLength) &&
    context.playlistLength > 0 &&
    isFiniteNonNegativeInteger(context.rowIndex) &&
    context.rowIndex < context.playlistLength
  )
}

function validateReorderMessage(message: unknown) {
  if (!message || typeof message !== "object") {
    throw new Error("Invalid reorder request payload.")
  }

  const payload = message as {
    type?: unknown
    moveTo?: unknown
    targetIndex?: unknown
    context?: unknown
  }

  if (payload.type !== "spotify-reorder-track") {
    throw new Error("Unsupported message type.")
  }

  if (
    typeof payload.moveTo !== "string" ||
    !ALLOWED_MOVE_TO.has(payload.moveTo as never)
  ) {
    throw new Error("Invalid reorder destination.")
  }

  if (!isValidTrackContext(payload.context)) {
    throw new Error("Invalid track context.")
  }

  if (payload.moveTo === "index") {
    if (!isFiniteNonNegativeInteger(payload.targetIndex)) {
      throw new Error("Invalid target index.")
    }
  } else if (typeof payload.targetIndex !== "undefined") {
    throw new Error("Unexpected target index.")
  }

  return {
    moveTo: payload.moveTo as "top" | "middle" | "bottom" | "index",
    targetIndex: payload.targetIndex as number | undefined,
    context: payload.context
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders ?? []
    let accessToken: string | null = null
    let clientToken: string | null = null

    for (const header of headers) {
      const name = header.name.toLowerCase()
      if (name === "authorization" && header.value?.startsWith("Bearer ")) {
        accessToken = header.value.replace("Bearer ", "")
      }
      if (name === "client-token" && header.value) {
        clientToken = header.value
      }
    }

    if (accessToken) {
      chrome.storage.local.set({ capturedAccessToken: accessToken })
    }
    if (clientToken) {
      chrome.storage.local.set({ capturedClientToken: clientToken })
    }
  },
  { urls: ["https://api-partner.spotify.com/*", "https://api.spotify.com/*"] },
  ["requestHeaders", "extraHeaders"]
)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let attempt = 0
  while (true) {
    const res = await fetch(url, init)
    if (res.status !== 429 || attempt >= maxRetries) {
      return res
    }
    const retryAfter = Number(res.headers.get("Retry-After") ?? "1")
    const waitMs = (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000
    await delay(waitMs)
    attempt++
  }
}

async function getAllTracks(
  token: string,
  playlistId: string
): Promise<TrackItem[]> {
  const items: TrackItem[] = []
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks` +
    `?fields=items(track(id,name,uri)),next&limit=100&offset=0`

  while (url) {
    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) {
      const err: SpotifyErrorBody = await res.json().catch(() => ({}))
      throw new Error(err.error?.message ?? `HTTP ${res.status}`)
    }
    const data: SpotifyTracksPage = await res.json()
    for (const item of data.items) {
      if (!item?.track) continue
      items.push({
        position: items.length,
        name: item.track.name || "Unknown",
        id: item.track.id,
        uri: item.track.uri
      })
    }
    url = data.next
  }

  return items
}

async function reorderTrack(
  accessToken: string,
  playlistId: string,
  rangeStart: number,
  insertBefore: number
): Promise<{ snapshot_id: string }> {
  const response = await fetchWithRetry(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        range_start: rangeStart,
        insert_before: insertBefore,
        range_length: 1
      })
    }
  )

  if (!response.ok) {
    throw new Error(
      `Spotify reorder failed (${response.status}): ${await response.text()}`
    )
  }

  return response.json()
}

async function moveItemsInPlaylist(
  accessToken: string,
  clientToken: string,
  playlistUri: string,
  uids: string[],
  fromUid: string,
  moveType: "BEFORE_UID" | "AFTER_UID" = "BEFORE_UID"
): Promise<unknown> {
  const response = await fetchWithRetry(
    "https://api-partner.spotify.com/pathfinder/v2/query",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Token": clientToken,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json",
        "App-Platform": "WebPlayer"
      },
      body: JSON.stringify({
        variables: {
          playlistUri,
          uids,
          newPosition: { moveType, fromUid }
        },
        operationName: "moveItemsInPlaylist",
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash:
              "47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990"
          }
        }
      })
    }
  )

  if (!response.ok) {
    throw new Error(
      `Spotify move failed (${response.status}): ${await response.text()}`
    )
  }

  const body = (await response.json()) as {
    errors?: { message?: string }[]
    data?: unknown
  }
  if (body?.errors?.length) {
    throw new Error(body.errors[0]?.message ?? "Spotify GraphQL error")
  }
  return body
}
async function handleContextMenuReorder(
  context: TrackContext,
  moveTo: "top" | "middle" | "bottom" | "index",
  targetIndex?: number
) {
  const stored = (await chrome.storage.local.get(["capturedAccessToken"])) as {
    capturedAccessToken?: string
  }

  if (!stored.capturedAccessToken) {
    throw new Error(
      "No Spotify access token captured. Browse open.spotify.com to capture tokens automatically."
    )
  }

  const insertBefore =
    moveTo === "top"
      ? 0
      : moveTo === "middle"
        ? Math.floor(context.playlistLength / 2)
        : moveTo === "index"
          ? Math.max(0, Math.min(targetIndex ?? 0, context.playlistLength))
          : Math.max(context.playlistLength, 1)

  await reorderTrack(
    stored.capturedAccessToken,
    context.playlistId,
    context.rowIndex,
    insertBefore
  )

  return {
    ok: true,
    message:
      moveTo === "index"
        ? `Moved "${context.trackName}" to position ${(targetIndex ?? 0) + 1}.`
        : `Moved "${context.trackName}" to the ${moveTo} of the playlist.`
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Context-menu reorder dispatched by the content script
  if (message?.type === "spotify-reorder-track") {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({
        ok: false,
        error: "Rejected message from unexpected sender."
      })
      return false
    }

    let validated: ReturnType<typeof validateReorderMessage>
    try {
      validated = validateReorderMessage(message)
    } catch (error) {
      sendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : "Invalid reorder request."
      })
      return false
    }

    void handleContextMenuReorder(
      validated.context,
      validated.moveTo,
      validated.targetIndex
    )
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Spotify reorder failed."
        })
      )

    return true
  }

  if (message?.type === "FETCH_PLAYLIST") {
    const { accessToken, playlistId } = message as {
      accessToken: string
      playlistId: string
    }

    void getAllTracks(accessToken, playlistId)
      .then((items) => sendResponse({ items }))
      .catch((err: unknown) =>
        sendResponse({
          error:
            err instanceof Error
              ? err.message
              : "Failed to fetch playlist tracks."
        })
      )

    return true
  }

  if (message?.type === "REORDER_TRACK") {
    const { accessToken, playlistId, rangeStart, insertBefore } = message as {
      accessToken: string
      playlistId: string
      rangeStart: number
      insertBefore: number
    }

    void reorderTrack(accessToken, playlistId, rangeStart, insertBefore)
      .then((data) => sendResponse({ status: 200, data }))
      .catch((err: unknown) =>
        sendResponse({
          error: err instanceof Error ? err.message : "Track reorder failed."
        })
      )

    return true
  }

  if (message?.type === "MOVE_ITEMS") {
    const {
      accessToken,
      clientToken,
      playlistUri,
      uids,
      fromUid,
      moveType = "BEFORE_UID"
    } = message as {
      accessToken: string
      clientToken: string
      playlistUri: string
      uids: string[]
      fromUid: string
      moveType?: "BEFORE_UID" | "AFTER_UID"
    }

    void moveItemsInPlaylist(
      accessToken,
      clientToken,
      playlistUri,
      uids,
      fromUid,
      moveType
    )
      .then((data) => sendResponse({ status: 200, data }))
      .catch((err: unknown) =>
        sendResponse({
          error: err instanceof Error ? err.message : "Track move failed."
        })
      )

    return true
  }
})
