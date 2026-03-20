const CLIENT_ID = "9a009d1f37a6430fac6446d53dc0999a"

type TrackContext = {
  playlistId: string
  playlistLength: number
  trackName: string
  trackId: string
  rowIndex: number
}

type StoredAuthState = {
  spotify_access_token?: string
  spotify_refresh_token?: string
  spotify_expires_at?: number
}

type SpotifyUserProfile = {
  id?: string
  product?: string
}

type SpotifyPlaylist = {
  collaborative?: boolean
  public?: boolean | null
  owner?: {
    id?: string
  }
  name?: string
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

  if (typeof payload.moveTo !== "string" || !ALLOWED_MOVE_TO.has(payload.moveTo as never)) {
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

async function getStoredAuth() {
  return chrome.storage.local.get([
    "spotify_access_token",
    "spotify_refresh_token",
    "spotify_expires_at"
  ]) as Promise<StoredAuthState>
}

async function refreshAccessToken(refreshToken: string) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  })

  if (!response.ok) {
    throw new Error(`Spotify refresh failed: ${await response.text()}`)
  }

  return response.json()
}

async function getValidAccessToken() {
  const stored = await getStoredAuth()

  if (
    stored.spotify_access_token &&
    stored.spotify_expires_at &&
    Date.now() < stored.spotify_expires_at - 60_000
  ) {
    return stored.spotify_access_token
  }

  if (!stored.spotify_refresh_token) {
    throw new Error("No Spotify refresh token found. Reconnect the extension from the popup.")
  }

  const refreshed = await refreshAccessToken(stored.spotify_refresh_token)
  const expiresAt = Date.now() + refreshed.expires_in * 1000

  await chrome.storage.local.set({
    spotify_access_token: refreshed.access_token,
    spotify_expires_at: expiresAt,
    ...(refreshed.refresh_token
      ? { spotify_refresh_token: refreshed.refresh_token }
      : {})
  })

  return refreshed.access_token as string
}

async function reorderTrack(
  accessToken: string,
  playlistId: string,
  fromIndex: number,
  insertBefore: number
) {
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/items`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range_start: fromIndex,
      insert_before: insertBefore,
      range_length: 1
    })
  })

  if (!response.ok) {
    throw new Error(`Spotify reorder failed: ${await response.text()}`)
  }

  return response.json()
}

async function getCurrentUserProfile(accessToken: string) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    throw new Error(`Spotify profile lookup failed: ${await response.text()}`)
  }

  return (await response.json()) as SpotifyUserProfile
}

async function getPlaylistDetails(accessToken: string, playlistId: string) {
  const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    throw new Error(`Spotify playlist lookup failed: ${await response.text()}`)
  }

  return (await response.json()) as SpotifyPlaylist
}

async function buildForbiddenDiagnostic(accessToken: string, context: TrackContext) {
  try {
    const [profile, playlist] = await Promise.all([
      getCurrentUserProfile(accessToken),
      getPlaylistDetails(accessToken, context.playlistId)
    ])

    const ownerId = playlist.owner?.id ?? "unknown"
    const userId = profile.id ?? "unknown"
    const ownsPlaylist = ownerId !== "unknown" && ownerId === userId
    const collaborative = Boolean(playlist.collaborative)
    const playlistType =
      playlist.public === true ? "public" : playlist.public === false ? "private" : "unknown"

    return [
      "Spotify returned 403 Forbidden.",
      `Current user: ${userId}`,
      `Playlist owner: ${ownerId}`,
      `Owns playlist: ${ownsPlaylist ? "yes" : "no"}`,
      `Collaborative playlist: ${collaborative ? "yes" : "no"}`,
      `Playlist visibility: ${playlistType}`,
      `Account product: ${profile.product ?? "unknown"}`,
      "If you do own this playlist, the most likely causes are missing modify consent on the token or Spotify app access restrictions in developer mode."
    ].join(" ")
  } catch (error) {
    return error instanceof Error
      ? `Spotify returned 403 Forbidden. Diagnostic lookup also failed: ${error.message}`
      : "Spotify returned 403 Forbidden. Diagnostic lookup also failed."
  }
}

async function handleReorderRequest(
  context: TrackContext,
  moveTo: "top" | "middle" | "bottom" | "index",
  targetIndex?: number
) {
  const accessToken = await getValidAccessToken()
  const insertBefore =
    moveTo === "top"
      ? 0
      : moveTo === "middle"
        ? Math.floor(context.playlistLength / 2)
        : moveTo === "index"
          ? Math.max(0, Math.min(targetIndex ?? 0, context.playlistLength))
          : Math.max(context.playlistLength, 1)

  try {
    await reorderTrack(accessToken, context.playlistId, context.rowIndex, insertBefore)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('"status": 403')
    ) {
      throw new Error(await buildForbiddenDiagnostic(accessToken, context))
    }

    throw error
  }

  return {
    ok: true,
    message:
      moveTo === "index"
        ? `Moved "${context.trackName}" to position ${(targetIndex ?? 0) + 1}.`
        : `Moved "${context.trackName}" to the ${moveTo} of the playlist.`
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "spotify-reorder-track") {
    return
  }

  if (sender.id !== chrome.runtime.id) {
    sendResponse({
      ok: false,
      error: "Rejected message from unexpected sender."
    })
    return false
  }

  let validatedMessage: ReturnType<typeof validateReorderMessage>

  try {
    validatedMessage = validateReorderMessage(message)
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid reorder request."
    })
    return false
  }

  void handleReorderRequest(
    validatedMessage.context,
    validatedMessage.moveTo,
    validatedMessage.targetIndex
  )
    .then((result) => {
      sendResponse(result)
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Spotify reorder failed."
      })
    })

  return true
})
