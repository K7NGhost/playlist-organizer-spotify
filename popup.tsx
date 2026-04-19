import logo from "data-base64:~assets/logo.png"
import { useCallback, useEffect, useState } from "react"

type TrackItem = {
  position: number
  name: string
  id: string
  uri: string
  uid: string // playlist-item UID from the partner API
  trackNumber?: number
}

type InterceptedPlaylist = {
  id: string
  uri: string
  tracks: TrackItem[]
  complete: boolean
  totalCount?: number
}

function isSameTrack(a: TrackItem, b: TrackItem) {
  if (a.uid && b.uid) {
    return a.uid === b.uid
  }

  return (
    a.position === b.position &&
    a.id === b.id &&
    a.name === b.name &&
    a.uri === b.uri
  )
}

function reorderCachedTracks(
  tracks: TrackItem[],
  movedTrack: TrackItem,
  insertBefore: number
) {
  const sorted = [...tracks].sort((a, b) => a.position - b.position)
  const fromIndex = sorted.findIndex((track) => isSameTrack(track, movedTrack))

  if (fromIndex === -1) {
    return tracks
  }

  const next = [...sorted]
  const [removed] = next.splice(fromIndex, 1)

  let targetIndex = insertBefore
  if (fromIndex < insertBefore) {
    targetIndex -= 1
  }

  targetIndex = Math.max(0, Math.min(targetIndex, next.length))
  next.splice(targetIndex, 0, removed)

  return next.map((track, index) => ({
    ...track,
    position: index
  }))
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  width: 380,
  minHeight: 520,
  margin: 0,
  padding: 16,
  boxSizing: "border-box",
  fontFamily:
    '"Segoe UI", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
  color: "#f7f7f7",
  background: "linear-gradient(180deg, #0b0b0b 0%, #050505 100%)"
}

const cardStyle: React.CSSProperties = {
  position: "relative",
  background:
    "radial-gradient(circle at top left, rgba(29,185,84,0.22) 0%, rgba(22,22,22,0.98) 34%, rgba(8,8,8,1) 100%)",
  borderRadius: 28,
  padding: "20px 18px 22px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.4)"
}

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  border: "none",
  borderRadius: 999,
  padding: "11px 16px",
  background: "#1db954",
  color: "#08140d",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  marginBottom: 8
}

const secondaryBtnStyle: React.CSSProperties = {
  ...primaryBtnStyle,
  background: "rgba(255,255,255,0.08)",
  color: "#f7f7f7"
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "9px 12px",
  background: "rgba(255,255,255,0.06)",
  color: "#f7f7f7",
  fontSize: 13,
  outline: "none"
}

const trackBtnStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  border: "none",
  borderRadius: 8,
  background: "rgba(255,255,255,0.05)",
  color: "#f7f7f7",
  fontSize: 13,
  cursor: "pointer",
  marginBottom: 4
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.4)",
  marginBottom: 8,
  marginTop: 16
}

const statusBoxStyle: React.CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.7)",
  padding: "9px 12px",
  background: "rgba(255,255,255,0.05)",
  borderRadius: 10,
  marginBottom: 12,
  lineHeight: 1.5
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function IndexPopup() {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [status, setStatus] = useState(
    "Browse open.spotify.com to auto-capture tokens."
  )
  const [isLoading, setIsLoading] = useState(false)

  // Playlist cache
  const [cachedItems, setCachedItems] = useState<TrackItem[]>([])
  const [cachedPlaylistId, setCachedPlaylistId] = useState<string | null>(null)
  const [cachedPlaylistUri, setCachedPlaylistUri] = useState<string | null>(
    null
  )
  const [clientToken, setClientToken] = useState<string | null>(null)

  // Track search
  const [trackQuery, setTrackQuery] = useState("")
  const [trackResults, setTrackResults] = useState<TrackItem[]>([])
  const [selectedTrack, setSelectedTrack] = useState<TrackItem | null>(null)

  // "Move after" search
  const [afterQuery, setAfterQuery] = useState("")
  const [afterResults, setAfterResults] = useState<TrackItem[]>([])
  const [selectedAfterTrack, setSelectedAfterTrack] =
    useState<TrackItem | null>(null)

  const [moveResult, setMoveResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  // Select-location input
  const [positionInput, setPositionInput] = useState("")
  const [showPositionInput, setShowPositionInput] = useState(false)

  // True playlist length from the API (may differ from cachedItems.length if one track failed to load)
  const [totalCount, setTotalCount] = useState<number | null>(null)

  const applyInterceptedPlaylist = useCallback((p: InterceptedPlaylist) => {
    const count = p.tracks.length
    const total = p.totalCount
    const countStr = total ? `${count} / ${total}` : `${count}`
    const note = p.complete ? `` : ` (loading...)`
    setCachedItems(p.tracks)
    setCachedPlaylistId(p.id)
    setCachedPlaylistUri(p.uri)
    if (total) setTotalCount(total)
    setStatus(
      `${countStr} song${count !== 1 ? "s" : ""} loaded${note}. Search to find a track.`
    )
  }, [])

  // Load stored tokens + intercepted playlist once, then watch for changes
  useEffect(() => {
    chrome.storage.local.get(
      ["capturedAccessToken", "capturedClientToken", "interceptedPlaylist"],
      (result) => {
        if (result.capturedAccessToken) {
          setAccessToken(result.capturedAccessToken as string)
        }
        if (result.capturedClientToken) {
          setClientToken(result.capturedClientToken as string)
        }
        if (result.interceptedPlaylist) {
          applyInterceptedPlaylist(
            result.interceptedPlaylist as InterceptedPlaylist
          )
        } else if (result.capturedAccessToken) {
          setStatus(
            "Token ready. Navigate to a Spotify playlist page to auto-load its tracks."
          )
        }
      }
    )

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>
    ) => {
      if (changes.capturedAccessToken?.newValue) {
        setAccessToken(changes.capturedAccessToken.newValue as string)
      } else if (
        "capturedAccessToken" in changes &&
        changes.capturedAccessToken?.newValue == null
      ) {
        setAccessToken(null)
        setStatus("Token cleared. Browse open.spotify.com to recapture.")
      }

      if (changes.capturedClientToken?.newValue) {
        setClientToken(changes.capturedClientToken.newValue as string)
      }

      if (changes.interceptedPlaylist?.newValue) {
        applyInterceptedPlaylist(
          changes.interceptedPlaylist.newValue as InterceptedPlaylist
        )
      } else if (
        "interceptedPlaylist" in changes &&
        changes.interceptedPlaylist?.newValue == null
      ) {
        setCachedItems([])
        setCachedPlaylistId(null)
        setCachedPlaylistUri(null)
      }
    }

    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [applyInterceptedPlaylist])

  // Filter the cached items by name
  const filterTracks = useCallback(
    (query: string, excludeId?: string): TrackItem[] => {
      const lower = query.toLowerCase().trim()
      const base = lower
        ? cachedItems.filter((t) => t.name.toLowerCase().includes(lower))
        : cachedItems.slice(0, 20)
      return excludeId ? base.filter((t) => t.id !== excludeId) : base
    },
    [cachedItems]
  )

  // Load tracks — prefers the intercepted cache (no API calls), falls back to REST
  const fetchPlaylist = useCallback(async (): Promise<TrackItem[] | null> => {
    // Check storage for an already-intercepted playlist
    const stored = await chrome.storage.local.get(["interceptedPlaylist"])
    const intercepted = stored.interceptedPlaylist as
      | InterceptedPlaylist
      | undefined

    // Match against the currently active Spotify tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    const match = tab?.url?.match(/\/playlist\/([a-zA-Z0-9]+)/)
    const currentPlaylistId = match?.[1]

    console.log(
      "[SPO:popup] fetchPlaylist — intercepted:",
      intercepted,
      "currentPlaylistId:",
      currentPlaylistId
    )

    if (
      intercepted &&
      currentPlaylistId &&
      intercepted.id === currentPlaylistId
    ) {
      console.log(
        "[SPO:popup] using intercepted data (",
        intercepted.tracks.length,
        "tracks)"
      )
      applyInterceptedPlaylist(intercepted)
      return intercepted.tracks
    }

    if (intercepted && !currentPlaylistId) {
      // Popup opened without a playlist tab — still use whatever was stored
      console.log(
        "[SPO:popup] no active playlist tab, using stored intercepted data"
      )
      applyInterceptedPlaylist(intercepted)
      return intercepted.tracks
    }

    // No intercepted data — fall back to the REST API
    if (!accessToken) {
      setStatus(
        "No token found. Browse a Spotify playlist page to auto-load tracks."
      )
      return null
    }

    if (!currentPlaylistId) {
      setStatus("Please open a Spotify playlist page first.")
      return null
    }

    setStatus("Loading playlist via REST API...")
    const response = (await chrome.runtime.sendMessage({
      type: "FETCH_PLAYLIST",
      accessToken,
      playlistId: currentPlaylistId
    })) as { items?: Omit<TrackItem, "uid">[]; error?: string }

    if (response?.error) {
      setStatus(`Error loading playlist: ${response.error}`)
      return null
    }

    const items: TrackItem[] = (response.items ?? []).map((t) => ({
      ...t,
      uid: ""
    }))
    setCachedItems(items)
    setCachedPlaylistId(currentPlaylistId)
    setCachedPlaylistUri(null)
    setTotalCount(items.length)
    return items
  }, [accessToken, applyInterceptedPlaylist])

  const handleSearchTracks = useCallback(async () => {
    setIsLoading(true)
    setMoveResult(null)
    setStatus("Loading playlist...")

    const items = cachedItems.length > 0 ? cachedItems : await fetchPlaylist()
    if (!items) {
      setIsLoading(false)
      return
    }

    const results = filterTracks(trackQuery).slice(0, 10)
    setTrackResults(results)
    setStatus(`${results.length} result(s). Click a track to select it.`)
    setIsLoading(false)
  }, [cachedItems, fetchPlaylist, filterTracks, trackQuery])

  const handleSearchAfterTracks = useCallback(async () => {
    if (!cachedItems.length) {
      const items = await fetchPlaylist()
      if (!items) return
    }
    setAfterResults(filterTracks(afterQuery, selectedTrack?.id).slice(0, 10))
  }, [
    cachedItems.length,
    fetchPlaylist,
    filterTracks,
    afterQuery,
    selectedTrack?.id
  ])

  const selectTrack = useCallback((item: TrackItem) => {
    setSelectedTrack(item)
    setSelectedAfterTrack(null)
    setAfterResults([])
    setTrackResults([])
    setMoveResult(null)
    setShowPositionInput(false)
    setPositionInput("")
    setStatus(`"${item.name}" selected. Choose where to move it.`)
  }, [])

  const selectAfterTrack = useCallback((item: TrackItem) => {
    setSelectedAfterTrack(item)
    setAfterResults([])
  }, [])

  const executeMove = useCallback(
    async (
      insertBefore: number,
      fromUid?: string,
      moveType: "BEFORE_UID" | "AFTER_UID" = "BEFORE_UID"
    ) => {
      if (!selectedTrack) {
        setMoveResult({ ok: false, message: "No track selected." })
        return
      }
      if (!accessToken) {
        setMoveResult({
          ok: false,
          message: "No access token. Browse open.spotify.com first."
        })
        return
      }
      if (!cachedPlaylistId) {
        setMoveResult({
          ok: false,
          message:
            "Playlist ID not found. Navigate to the Spotify playlist page first."
        })
        return
      }

      setIsLoading(true)
      setMoveResult(null)
      setStatus("Moving track...")

      // Prefer the UID-based partner API when we have all the required pieces
      const canUsePartnerApi =
        !!fromUid && !!clientToken && !!cachedPlaylistUri && !!selectedTrack.uid

      console.log("[SPO:popup] executeMove", {
        canUsePartnerApi,
        insertBefore,
        fromUid,
        selectedTrackUid: selectedTrack.uid,
        clientToken: clientToken ? "present" : "missing",
        cachedPlaylistUri
      })

      let response: { status?: number; data?: unknown; error?: string }
      try {
        response = (await chrome.runtime.sendMessage(
          canUsePartnerApi
            ? {
                type: "MOVE_ITEMS",
                accessToken,
                clientToken,
                playlistUri: cachedPlaylistUri,
                uids: [selectedTrack.uid],
                fromUid,
                moveType
              }
            : {
                type: "REORDER_TRACK",
                accessToken,
                playlistId: cachedPlaylistId,
                rangeStart: selectedTrack.position,
                insertBefore
              }
        )) as { status?: number; data?: unknown; error?: string }
      } catch (e) {
        setMoveResult({
          ok: false,
          message:
            e instanceof Error
              ? e.message
              : "Extension error - try reloading the page."
        })
        setStatus("Move failed.")
        setIsLoading(false)
        return
      }

      console.log("[SPO:popup] executeMove response", response)

      if (!response) {
        setMoveResult({
          ok: false,
          message: "No response from background. Try reloading the extension."
        })
        setStatus("Move failed.")
        setIsLoading(false)
        return
      }

      if (response?.error) {
        setMoveResult({ ok: false, message: response.error })
        setStatus("Move failed.")
      } else {
        const reorderedItems = reorderCachedTracks(
          cachedItems,
          selectedTrack,
          insertBefore
        )

        setMoveResult({
          ok: true,
          message: `Moved "${selectedTrack.name}" to position ${insertBefore + 1}.`
        })
        setStatus("Track moved. Search for another track or choose a new move.")
        setCachedItems(reorderedItems)
        setTrackResults([])
        setAfterResults([])

        if (cachedPlaylistId && cachedPlaylistUri) {
          await chrome.storage.local.set({
            interceptedPlaylist: {
              id: cachedPlaylistId,
              uri: cachedPlaylistUri,
              tracks: reorderedItems,
              complete: true,
              totalCount: totalCount ?? reorderedItems.length
            }
          })
        }

        setSelectedTrack(null)
        setSelectedAfterTrack(null)
        setTrackQuery("")
        setAfterQuery("")
        setShowPositionInput(false)
        setPositionInput("")
      }

      setIsLoading(false)
    },
    [
      accessToken,
      cachedItems,
      cachedPlaylistId,
      cachedPlaylistUri,
      clientToken,
      selectedTrack,
      totalCount
    ]
  )

  const moveToTop = useCallback(() => {
    if (!selectedTrack) return
    const sorted = [...cachedItems].sort((a, b) => a.position - b.position)
    // Find the first track that is NOT the selected track to use as the BEFORE_UID anchor
    const anchor = sorted.find((t) => t.uid !== selectedTrack.uid)
    void executeMove(0, anchor?.uid || undefined)
  }, [executeMove, selectedTrack, cachedItems])

  const moveToMiddle = useCallback(() => {
    if (!selectedTrack || !cachedItems.length) return
    const sorted = [...cachedItems].sort((a, b) => a.position - b.position)
    const midIdx = Math.floor(sorted.length / 2)
    const candidate = sorted[midIdx]
    const fromUid =
      candidate?.uid !== selectedTrack.uid
        ? candidate?.uid
        : sorted[midIdx + 1]?.uid
    void executeMove(midIdx, fromUid || undefined)
  }, [executeMove, selectedTrack, cachedItems])

  const moveToBottom = useCallback(() => {
    if (!selectedTrack || !cachedItems.length) return
    const sorted = [...cachedItems].sort((a, b) => a.position - b.position)
    // Use AFTER_UID with the last non-selected track so the partner API places
    // the track at the true end of the playlist.
    const lastAnchor = [...sorted]
      .reverse()
      .find((t) => t.uid !== selectedTrack.uid)
    void executeMove(
      totalCount ?? cachedItems.length,
      lastAnchor?.uid || undefined,
      "AFTER_UID"
    )
  }, [executeMove, selectedTrack, cachedItems, totalCount])

  const moveToPosition = useCallback(
    (oneBased: number) => {
      if (!selectedTrack || !cachedItems.length) return
      const sorted = [...cachedItems].sort((a, b) => a.position - b.position)
      const zeroIdx = Math.max(0, Math.min(oneBased - 1, sorted.length))
      const candidate = sorted[zeroIdx]
      const fromUid =
        candidate?.uid !== selectedTrack.uid
          ? candidate?.uid
          : sorted[zeroIdx + 1]?.uid
      void executeMove(zeroIdx, fromUid || undefined)
    },
    [executeMove, selectedTrack, cachedItems]
  )

  const moveAfterSelected = useCallback(() => {
    if (!selectedTrack || !selectedAfterTrack) return
    const sorted = [...cachedItems].sort((a, b) => a.position - b.position)
    const afterIdx = sorted.findIndex((t) => t.uid === selectedAfterTrack.uid)
    const nextTrack = afterIdx !== -1 ? sorted[afterIdx + 1] : undefined

    // Compute fallback integer position (handles the REST path)
    const current = selectedTrack.position
    const after = selectedAfterTrack.position
    const insertBefore = after >= current ? after : after + 1

    void executeMove(insertBefore, nextTrack?.uid || undefined)
  }, [executeMove, selectedAfterTrack, selectedTrack, cachedItems])

  const clearTokens = useCallback(async () => {
    await chrome.storage.local.remove([
      "capturedAccessToken",
      "capturedClientToken",
      "interceptedPlaylist"
    ])
    setAccessToken(null)
    setClientToken(null)
    setCachedItems([])
    setCachedPlaylistId(null)
    setCachedPlaylistUri(null)
    setSelectedTrack(null)
    setSelectedAfterTrack(null)
    setMoveResult(null)
    setShowPositionInput(false)
    setPositionInput("")
    setTotalCount(null)
    setStatus("Tokens cleared. Browse Spotify to recapture.")
  }, [])

  const hasToken = Boolean(accessToken)

  return (
    <div style={pageStyle}>
      <style>{`
        html, body { margin: 0; padding: 0; background: #090909; }
        button { transition: filter 0.1s; }
        button:hover:not(:disabled) { filter: brightness(1.15); }
        button:disabled { opacity: 0.45 !important; cursor: default !important; }
        input::placeholder { color: rgba(255,255,255,0.28); }
        input:focus { border-color: rgba(29,185,84,0.5) !important; }
      `}</style>

      <div style={cardStyle}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16
          }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              overflow: "hidden",
              flexShrink: 0
            }}>
            <img
              src={logo}
              alt="logo"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div>
            <p
              style={{
                margin: 0,
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.4)"
              }}>
              Playlist Organizer
            </p>
            <h1 style={{ margin: 0, fontSize: 17, lineHeight: 1.2 }}>
              Spotify
              <span
                style={{
                  display: "inline-block",
                  marginLeft: 8,
                  padding: "2px 9px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  verticalAlign: "middle",
                  background: hasToken
                    ? "rgba(30,215,96,0.15)"
                    : "rgba(255,255,255,0.06)",
                  color: hasToken ? "#1ed760" : "rgba(255,255,255,0.45)"
                }}>
                {hasToken ? "Token ready" : "No token"}
              </span>
            </h1>
          </div>
        </div>

        {/* Status */}
        <div style={statusBoxStyle}>{status}</div>

        {/*Find & Move Track */}
        <p style={sectionTitleStyle}>Find &amp; Move Track</p>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            style={inputStyle}
            placeholder="Search for a track"
            value={trackQuery}
            disabled={!hasToken}
            onChange={(e) => setTrackQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearchTracks()}
          />
          <button
            style={{
              ...secondaryBtnStyle,
              width: "auto",
              padding: "9px 14px",
              marginBottom: 0
            }}
            onClick={() => void handleSearchTracks()}
            disabled={isLoading || !hasToken}
            type="button">
            Search
          </button>
        </div>

        {/* Track search results */}
        {trackResults.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {trackResults.map((item) => (
              <button
                key={item.id}
                style={trackBtnStyle}
                onClick={() => selectTrack(item)}
                type="button"
                title={`Position: ${item.position + 1}`}>
                {item.name}
                <span
                  style={{
                    float: "right",
                    color: "rgba(255,255,255,0.38)",
                    fontSize: 11
                  }}>
                  #{item.position + 1}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Selected track + move controls */}
        {selectedTrack && (
          <div>
            <p style={{ ...sectionTitleStyle, marginTop: 0 }}>Selected</p>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(30,215,96,0.1)",
                border: "1px solid rgba(30,215,96,0.2)",
                fontSize: 13,
                marginBottom: 12
              }}>
              {selectedTrack.name}
              <span
                style={{
                  marginLeft: 8,
                  color: "rgba(255,255,255,0.4)",
                  fontSize: 11
                }}>
                pos #{selectedTrack.position + 1}
              </span>
            </div>

            <button
              style={primaryBtnStyle}
              onClick={moveToTop}
              disabled={isLoading}
              type="button">
              Move to Top
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={moveToMiddle}
              disabled={isLoading}
              type="button">
              Move to Middle
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={moveToBottom}
              disabled={isLoading}
              type="button">
              Move to Bottom
            </button>

            <button
              style={{
                ...secondaryBtnStyle,
                marginBottom: showPositionInput ? 6 : 8,
                background: showPositionInput
                  ? "rgba(29,185,84,0.15)"
                  : "rgba(255,255,255,0.08)"
              }}
              onClick={() => setShowPositionInput((v) => !v)}
              disabled={isLoading}
              type="button">
              Select Location
            </button>

            {showPositionInput && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  style={{ ...inputStyle, width: 90, flex: "none" }}
                  type="number"
                  min={1}
                  max={cachedItems.length || undefined}
                  placeholder={`1-${cachedItems.length || "?"}`}
                  value={positionInput}
                  onChange={(e) => setPositionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(positionInput, 10)
                      if (n >= 1) {
                        setShowPositionInput(false)
                        moveToPosition(n)
                      }
                    }
                  }}
                  autoFocus
                />
                <button
                  style={{
                    ...primaryBtnStyle,
                    width: "auto",
                    padding: "9px 18px",
                    marginBottom: 0
                  }}
                  onClick={() => {
                    const n = parseInt(positionInput, 10)
                    if (n >= 1) {
                      setShowPositionInput(false)
                      moveToPosition(n)
                    }
                  }}
                  disabled={isLoading || !positionInput}
                  type="button">
                  Go
                </button>
              </div>
            )}

            <p style={sectionTitleStyle}>Move after a specific track</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                style={inputStyle}
                placeholder="Search target track..."
                value={afterQuery}
                onChange={(e) => setAfterQuery(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && void handleSearchAfterTracks()
                }
              />
              <button
                style={{
                  ...secondaryBtnStyle,
                  width: "auto",
                  padding: "9px 14px",
                  marginBottom: 0
                }}
                onClick={() => void handleSearchAfterTracks()}
                disabled={isLoading}
                type="button">
                Search
              </button>
            </div>

            {afterResults.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {afterResults.map((item) => (
                  <button
                    key={item.id}
                    style={trackBtnStyle}
                    onClick={() => selectAfterTrack(item)}
                    type="button"
                    title={`Position: ${item.position + 1}`}>
                    {item.name}
                    <span
                      style={{
                        float: "right",
                        color: "rgba(255,255,255,0.38)",
                        fontSize: 11
                      }}>
                      #{item.position + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {selectedAfterTrack && (
              <div
                style={{
                  marginBottom: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.05)",
                  fontSize: 13
                }}>
                After:{" "}
                <strong style={{ color: "#f7f7f7" }}>
                  {selectedAfterTrack.name}
                </strong>
                <span
                  style={{
                    marginLeft: 6,
                    color: "rgba(255,255,255,0.4)",
                    fontSize: 11
                  }}>
                  pos #{selectedAfterTrack.position + 1}
                </span>
              </div>
            )}

            <button
              style={{ ...secondaryBtnStyle, marginBottom: 0 }}
              onClick={moveAfterSelected}
              disabled={isLoading || !selectedAfterTrack}
              type="button">
              Move After Selected
            </button>
          </div>
        )}

        {/* Move result */}
        {moveResult && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: moveResult.ok
                ? "rgba(30,215,96,0.1)"
                : "rgba(200,50,50,0.15)",
              border: `1px solid ${moveResult.ok ? "rgba(30,215,96,0.25)" : "rgba(200,50,50,0.3)"}`,
              fontSize: 12,
              color: moveResult.ok ? "#1ed760" : "#ff6b6b"
            }}>
            {moveResult.message}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 18 }}>
          <button
            style={{
              ...secondaryBtnStyle,
              fontSize: 12,
              padding: "9px 14px",
              background: "rgba(255,255,255,0.04)",
              marginBottom: 0
            }}
            onClick={() => void clearTokens()}
            type="button">
            Clear stored tokens
          </button>
        </div>
      </div>
    </div>
  )
}

export default IndexPopup
