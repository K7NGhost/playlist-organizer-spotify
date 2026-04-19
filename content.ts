import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://open.spotify.com/*"]
}

const TOAST_ID = "spotify-playlist-organizer-toast"
const MENU_ATTR = "data-spotify-playlist-organizer-menu"
const REORDER_ITEM_ATTR = "data-spotify-playlist-organizer-reorder"
const SUBMENU_ROOT_ID = "spotify-playlist-organizer-submenu-root"
const POSITION_DIALOG_ID = "spotify-playlist-organizer-position-dialog"

type TrackContext = {
  playlistId: string
  playlistLength: number
  trackName: string
  trackId: string
  rowIndex: number
}

let activeTrackContext: TrackContext | null = null
let reorderExpanded = false
let lastMenuSignature = ""
let closeSubmenuTimeout: number | null = null

function extractTrackContext(trackRow: Element): TrackContext | null {
  const rowContainer = trackRow.parentElement
  const rowIndexValue = rowContainer?.getAttribute("aria-rowindex")
  const trackRowIndex = Number.parseInt(rowIndexValue ?? "", 10)

  if (!Number.isFinite(trackRowIndex)) {
    return null
  }

  const playlistPage = document.querySelector<HTMLElement>(
    '[data-testid="playlist-page"]'
  )
  const playlistUri = playlistPage?.getAttribute("data-test-uri")
  const playlistId = playlistUri?.split(":").pop()

  if (!playlistId) {
    return null
  }

  const tracklist = document.querySelector<HTMLElement>(
    '[data-testid="playlist-tracklist"]'
  )
  const ariaRowCount = Number.parseInt(
    tracklist?.getAttribute("aria-rowcount") ?? "",
    10
  )
  const playlistLength = Number.isFinite(ariaRowCount)
    ? Math.max(ariaRowCount - 1, 1)
    : 1

  const trackLink = trackRow.querySelector<HTMLAnchorElement>(
    '[data-testid="internal-track-link"]'
  )
  const trackId = trackLink
    ?.getAttribute("href")
    ?.split("/track/")[1]
    ?.split("?")[0]
  const trackName = trackLink?.textContent?.trim() ?? "Selected track"

  if (!trackId) {
    return null
  }

  return {
    playlistId,
    playlistLength,
    trackName,
    trackId,
    rowIndex: trackRowIndex - 2
  }
}

function showToast(message: string, isError = false) {
  const existingToast = document.getElementById(TOAST_ID)

  if (existingToast) {
    existingToast.remove()
  }

  const toast = document.createElement("div")
  toast.id = TOAST_ID
  toast.textContent = message
  toast.style.position = "fixed"
  toast.style.right = "24px"
  toast.style.bottom = "24px"
  toast.style.zIndex = "2147483647"
  toast.style.maxWidth = "340px"
  toast.style.padding = "12px 14px"
  toast.style.borderRadius = "14px"
  toast.style.background = isError
    ? "rgba(122, 28, 28, 0.96)"
    : "rgba(17, 17, 17, 0.96)"
  toast.style.color = "#ffffff"
  toast.style.fontFamily = '"Segoe UI", sans-serif'
  toast.style.fontSize = "13px"
  toast.style.lineHeight = "1.4"
  toast.style.boxShadow = "0 14px 40px rgba(0, 0, 0, 0.35)"
  toast.style.border = isError
    ? "1px solid rgba(255, 120, 120, 0.35)"
    : "1px solid rgba(30, 215, 96, 0.25)"

  document.body.appendChild(toast)

  window.setTimeout(() => {
    toast.remove()
  }, 3200)
}

function closePositionDialog() {
  document.getElementById(POSITION_DIALOG_ID)?.remove()
}

function openPositionDialog(onSubmit: (index: number) => void) {
  if (!activeTrackContext) {
    showToast("No Spotify track is selected for reordering.", true)
    return
  }

  closePositionDialog()

  const totalPositions = activeTrackContext.playlistLength
  const currentPosition = Math.min(
    activeTrackContext.rowIndex + 1,
    totalPositions
  )

  const overlay = document.createElement("div")
  overlay.id = POSITION_DIALOG_ID
  overlay.style.position = "fixed"
  overlay.style.inset = "0"
  overlay.style.zIndex = "2147483647"
  overlay.style.display = "flex"
  overlay.style.alignItems = "center"
  overlay.style.justifyContent = "center"
  overlay.style.background = "rgba(0, 0, 0, 0.72)"
  overlay.style.backdropFilter = "blur(10px)"

  const dialog = document.createElement("div")
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.style.width = "min(420px, calc(100vw - 32px))"
  dialog.style.borderRadius = "12px"
  dialog.style.background = "#121212"
  dialog.style.border = "1px solid rgba(255, 255, 255, 0.08)"
  dialog.style.boxShadow = "0 24px 80px rgba(0, 0, 0, 0.5)"
  dialog.style.padding = "24px"
  dialog.style.color = "#ffffff"
  dialog.style.fontFamily = '"CircularStd", "Segoe UI", sans-serif'

  const title = document.createElement("h2")
  title.textContent = "Move track"
  title.style.margin = "0 0 8px"
  title.style.fontSize = "1.5rem"
  title.style.fontWeight = "700"

  const subtitle = document.createElement("p")
  subtitle.textContent = `Choose a new position for "${activeTrackContext.trackName}".`
  subtitle.style.margin = "0 0 16px"
  subtitle.style.color = "rgba(255, 255, 255, 0.7)"
  subtitle.style.fontSize = "0.95rem"
  subtitle.style.lineHeight = "1.5"

  const label = document.createElement("label")
  label.textContent = `Playlist position (1-${totalPositions})`
  label.style.display = "block"
  label.style.marginBottom = "8px"
  label.style.fontSize = "0.9rem"
  label.style.fontWeight = "600"

  const input = document.createElement("input")
  input.type = "number"
  input.min = "1"
  input.max = String(totalPositions)
  input.value = String(currentPosition)
  input.style.width = "100%"
  input.style.boxSizing = "border-box"
  input.style.height = "48px"
  input.style.padding = "0 14px"
  input.style.borderRadius = "8px"
  input.style.border = "1px solid rgba(255, 255, 255, 0.18)"
  input.style.background = "#222222"
  input.style.color = "#ffffff"
  input.style.fontSize = "1rem"
  input.style.outline = "none"
  input.style.marginBottom = "12px"

  const helper = document.createElement("p")
  helper.textContent = "Enter the exact slot you want this track moved to."
  helper.style.margin = "0 0 20px"
  helper.style.color = "rgba(255, 255, 255, 0.55)"
  helper.style.fontSize = "0.85rem"

  const actions = document.createElement("div")
  actions.style.display = "flex"
  actions.style.justifyContent = "flex-end"
  actions.style.gap = "12px"

  const cancelButton = document.createElement("button")
  cancelButton.type = "button"
  cancelButton.textContent = "Cancel"
  cancelButton.style.height = "40px"
  cancelButton.style.padding = "0 18px"
  cancelButton.style.borderRadius = "999px"
  cancelButton.style.border = "1px solid rgba(255, 255, 255, 0.18)"
  cancelButton.style.background = "transparent"
  cancelButton.style.color = "#ffffff"
  cancelButton.style.fontWeight = "700"
  cancelButton.style.cursor = "pointer"

  const submitButton = document.createElement("button")
  submitButton.type = "button"
  submitButton.textContent = "Move"
  submitButton.style.height = "40px"
  submitButton.style.padding = "0 20px"
  submitButton.style.borderRadius = "999px"
  submitButton.style.border = "none"
  submitButton.style.background = "#1ed760"
  submitButton.style.color = "#000000"
  submitButton.style.fontWeight = "700"
  submitButton.style.cursor = "pointer"

  const submit = () => {
    const parsed = Number.parseInt(input.value, 10)

    if (!Number.isFinite(parsed) || parsed < 1 || parsed > totalPositions) {
      showToast(
        `Enter a valid playlist position between 1 and ${totalPositions}.`,
        true
      )
      input.focus()
      input.select()
      return
    }

    closePositionDialog()
    onSubmit(parsed - 1)
  }

  cancelButton.addEventListener("click", closePositionDialog)
  submitButton.addEventListener("click", submit)
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePositionDialog()
    }
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      submit()
    }

    if (event.key === "Escape") {
      event.preventDefault()
      closePositionDialog()
    }
  })

  actions.append(cancelButton, submitButton)
  dialog.append(title, subtitle, label, input, helper, actions)
  overlay.appendChild(dialog)
  document.body.appendChild(overlay)

  window.setTimeout(() => {
    input.focus()
    input.select()
  }, 0)
}

type StoredTrack = {
  uid: string
  id: string
  position: number
}

type StoredPlaylist = {
  id: string
  uri: string
  tracks: StoredTrack[]
  complete: boolean
}

async function sendReorderRequest(
  moveTo: "top" | "middle" | "bottom" | "index",
  targetIndex?: number
) {
  if (!activeTrackContext) {
    showToast("No Spotify track is selected for reordering.", true)
    return
  }

  const destinationLabel =
    moveTo === "index" ? `position ${targetIndex! + 1}` : moveTo

  showToast(
    `Moving "${activeTrackContext.trackName}" to ${destinationLabel}...`
  )

  try {
    // --- Try partner API (UID-based) first using intercepted playlist data ---
    const stored = await chrome.storage.local.get([
      "interceptedPlaylist",
      "capturedAccessToken",
      "capturedClientToken"
    ])

    const intercepted = stored.interceptedPlaylist as StoredPlaylist | undefined
    const accessToken = stored.capturedAccessToken as string | undefined
    const clientToken = stored.capturedClientToken as string | undefined

    if (
      intercepted &&
      accessToken &&
      clientToken &&
      intercepted.id === activeTrackContext.playlistId
    ) {
      const sorted = [...intercepted.tracks].sort(
        (a, b) => a.position - b.position
      )
      const selectedTrack = sorted.find(
        (t) => t.id === activeTrackContext!.trackId
      )

      if (selectedTrack?.uid) {
        let fromUid: string | undefined
        let moveType: "BEFORE_UID" | "AFTER_UID" = "BEFORE_UID"

        if (moveTo === "top") {
          fromUid = sorted.find((t) => t.uid !== selectedTrack.uid)?.uid
        } else if (moveTo === "middle") {
          const midIdx = Math.floor(sorted.length / 2)
          const candidate = sorted[midIdx]
          fromUid =
            candidate?.uid !== selectedTrack.uid
              ? candidate?.uid
              : sorted[midIdx + 1]?.uid
        } else if (moveTo === "index") {
          const zeroIdx = Math.max(
            0,
            Math.min(targetIndex ?? 0, sorted.length - 1)
          )
          const candidate = sorted[zeroIdx]
          fromUid =
            candidate?.uid !== selectedTrack.uid
              ? candidate?.uid
              : sorted[zeroIdx + 1]?.uid
        } else if (moveTo === "bottom") {
          const lastAnchor = [...sorted]
            .reverse()
            .find((t) => t.uid !== selectedTrack.uid)
          fromUid = lastAnchor?.uid
          moveType = "AFTER_UID"
        }

        if (fromUid) {
          const moveResponse = (await chrome.runtime.sendMessage({
            type: "MOVE_ITEMS",
            accessToken,
            clientToken,
            playlistUri: intercepted.uri,
            uids: [selectedTrack.uid],
            fromUid,
            moveType
          })) as { error?: string } | undefined

          if (!moveResponse?.error) {
            showToast(
              `Moved "${activeTrackContext.trackName}" to ${destinationLabel}.`
            )
            return
          }
          // Partner API failed — fall through to REST
        }
      }
    }

    // --- Fall back to REST API ---
    const response = await chrome.runtime.sendMessage({
      type: "spotify-reorder-track",
      moveTo,
      targetIndex,
      context: activeTrackContext
    })

    if (!response?.ok) {
      throw new Error(response?.error ?? "Spotify reorder failed.")
    }

    showToast(
      response.message ??
        `Moved "${activeTrackContext.trackName}" successfully.`
    )
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "Spotify reorder failed.",
      true
    )
  }
}

function createMenuButton(label: string, onClick: () => void) {
  const listItem = document.createElement("li")
  listItem.setAttribute("role", "presentation")
  listItem.className = "yqG4N5YYcY4uEujt"
  listItem.setAttribute(MENU_ATTR, "item")

  const button = document.createElement("button")
  button.className = "KzLH25pAEr43wpSc"
  button.setAttribute("role", "menuitem")
  button.tabIndex = -1

  const text = document.createElement("span")
  text.className =
    "e-10180-text encore-text-body-small ellipsis-one-line yjdsntzei5QWfVvE"
  text.setAttribute("data-encore-id", "text")
  text.setAttribute("dir", "auto")
  text.textContent = label

  button.appendChild(text)
  let handled = false

  const trigger = (event: Event) => {
    if (handled) {
      return
    }

    handled = true
    event.preventDefault()
    event.stopPropagation()
    onClick()
  }

  button.addEventListener("pointerdown", trigger)
  button.addEventListener("click", trigger)

  listItem.appendChild(button)
  return listItem
}

function removeExistingInjectedMenu(menuList: Element) {
  Array.from(menuList.children)
    .filter(
      (node) => node instanceof HTMLElement && node.hasAttribute(MENU_ATTR)
    )
    .forEach((node) => node.remove())
}

function clearCloseSubmenuTimeout() {
  if (closeSubmenuTimeout !== null) {
    window.clearTimeout(closeSubmenuTimeout)
    closeSubmenuTimeout = null
  }
}

function closeInjectedSubmenu() {
  clearCloseSubmenuTimeout()
  document.getElementById(SUBMENU_ROOT_ID)?.remove()
  reorderExpanded = false
}

function scheduleCloseInjectedSubmenu() {
  clearCloseSubmenuTimeout()
  closeSubmenuTimeout = window.setTimeout(() => {
    closeInjectedSubmenu()
  }, 140)
}

function getVisibleMenuList() {
  const selectors = [
    '[data-testid="context-menu"] [role="menu"][data-depth="0"]',
    '#context-menu [role="menu"][data-depth="0"]',
    '[role="menu"][data-depth="0"]',
    '[data-testid="context-menu"] [role="menu"]'
  ]

  const candidates = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector))
  )

  return (
    candidates.find((menu) => {
      if (menu.closest(`#${SUBMENU_ROOT_ID}`)) {
        return false
      }

      const rect = menu.getBoundingClientRect()
      const menuItemCount = menu.querySelectorAll('[role="menuitem"]').length

      return rect.width > 0 && rect.height > 0 && menuItemCount > 0
    }) ?? null
  )
}

function appendSubmenuActionItems(menuList: HTMLElement) {
  const topItem = createMenuButton("Move to top", () => {
    closeInjectedSubmenu()
    void sendReorderRequest("top")
  })

  const middleItem = createMenuButton("Move to middle", () => {
    closeInjectedSubmenu()
    void sendReorderRequest("middle")
  })

  const bottomItem = createMenuButton("Move to bottom", () => {
    closeInjectedSubmenu()
    void sendReorderRequest("bottom")
  })

  const selectLocationItem = createMenuButton("Select location", () => {
    closeInjectedSubmenu()
    openPositionDialog((targetIndex) => {
      void sendReorderRequest("index", targetIndex)
    })
  })

  for (const item of [topItem, middleItem, bottomItem, selectLocationItem]) {
    menuList.appendChild(item)
  }
}

function openReorderSubmenu(
  anchorButton: HTMLElement,
  sourceMenu: HTMLElement
) {
  if (!activeTrackContext) {
    return
  }

  clearCloseSubmenuTimeout()
  document.getElementById(SUBMENU_ROOT_ID)?.remove()

  const rect = anchorButton.getBoundingClientRect()
  const root = document.createElement("div")
  root.id = SUBMENU_ROOT_ID
  root.setAttribute("data-tippy-root", "")
  root.style.zIndex = "9999"
  root.style.position = "fixed"
  root.style.inset = "0 auto auto 0"
  root.style.margin = "0"
  root.style.visibility = "hidden"

  const container = document.createElement("div")
  container.id = "context-menu"
  container.setAttribute("data-testid", "context-menu")
  container.setAttribute("data-placement", "right-start")

  const menu = document.createElement("ul")
  menu.setAttribute("role", "menu")
  menu.setAttribute("data-depth", "1")
  menu.setAttribute("data-testid", "context-menu")
  menu.setAttribute("data-roving-interactive", "1")
  menu.className = sourceMenu.className

  appendSubmenuActionItems(menu)

  container.appendChild(menu)
  root.appendChild(container)

  root.addEventListener("mouseenter", clearCloseSubmenuTimeout)
  root.addEventListener("mouseleave", scheduleCloseInjectedSubmenu)

  document.body.appendChild(root)

  const submenuRect = root.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const gap = 4
  const edgePadding = 8

  const fitsRight =
    rect.right + gap + submenuRect.width <= viewportWidth - edgePadding
  const preferredLeft = fitsRight
    ? rect.right + gap
    : rect.left - submenuRect.width - gap

  const clampedLeft = Math.max(
    edgePadding,
    Math.min(preferredLeft, viewportWidth - submenuRect.width - edgePadding)
  )

  const preferredTop = rect.top
  const clampedTop = Math.max(
    edgePadding,
    Math.min(preferredTop, viewportHeight - submenuRect.height - edgePadding)
  )

  root.style.transform = `translate(${Math.round(clampedLeft)}px, ${Math.round(clampedTop)}px)`
  root.style.visibility = "visible"
  reorderExpanded = true
}

function injectReorderMenu(menuList: HTMLElement) {
  if (!activeTrackContext) {
    return
  }

  removeExistingInjectedMenu(menuList)

  const divider = document.createElement("div")
  divider.className = "EnQEoJ0Iq3oE3Rq2"
  divider.setAttribute(MENU_ATTR, "divider")

  const reorderItem = document.createElement("li")
  reorderItem.setAttribute("role", "presentation")
  reorderItem.className = "yqG4N5YYcY4uEujt"
  reorderItem.setAttribute(REORDER_ITEM_ATTR, "root")
  reorderItem.setAttribute(MENU_ATTR, "reorder-root")

  const reorderButton = document.createElement("button")
  reorderButton.className = "KzLH25pAEr43wpSc"
  reorderButton.setAttribute("role", "menuitem")
  reorderButton.setAttribute("aria-haspopup", "menu")
  reorderButton.setAttribute(
    "aria-expanded",
    reorderExpanded ? "true" : "false"
  )
  reorderButton.tabIndex = -1

  const left = document.createElement("div")
  left.className = "PgGA6lkwfsPRyLju"

  const label = document.createElement("span")
  label.className = "e-10180-text encore-text-body-small ellipsis-one-line"
  label.setAttribute("data-encore-id", "type")
  label.setAttribute("dir", "auto")
  label.textContent = "Reorder"
  left.appendChild(label)

  const right = document.createElement("div")
  right.className = "ZjUuEcrKk8dIiPHd"

  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  arrow.setAttribute("data-encore-id", "icon")
  arrow.setAttribute("role", "img")
  arrow.setAttribute("aria-hidden", "true")
  arrow.setAttribute("class", "e-10180-icon EA1tMtPbmisQKEPh")
  arrow.setAttribute("viewBox", "0 0 16 16")
  arrow.setAttribute(
    "style",
    "--encore-icon-height: var(--encore-graphic-size-decorative-smaller); --encore-icon-width: var(--encore-graphic-size-decorative-smaller);"
  )

  const arrowPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  )
  arrowPath.setAttribute("d", "M14 10 8 4l-6 6z")
  arrow.appendChild(arrowPath)
  right.appendChild(arrow)

  reorderButton.append(left, right)

  const openSubmenu = () => {
    openReorderSubmenu(reorderButton, menuList)
    reorderButton.setAttribute("aria-expanded", "true")
  }

  reorderButton.addEventListener("mouseenter", openSubmenu)
  reorderButton.addEventListener("focus", openSubmenu)
  reorderButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    openSubmenu()
  })

  reorderButton.addEventListener("mouseleave", scheduleCloseInjectedSubmenu)
  reorderItem.addEventListener("mouseleave", scheduleCloseInjectedSubmenu)
  reorderItem.addEventListener("mouseenter", clearCloseSubmenuTimeout)

  reorderItem.appendChild(reorderButton)
  menuList.append(divider, reorderItem)
}

function tryCaptureTrackContext(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return
  }

  const trackRow = target.closest('[data-testid="tracklist-row"]')

  if (!trackRow) {
    return
  }

  activeTrackContext = extractTrackContext(trackRow)
  closeInjectedSubmenu()
}

function scheduleMenuHydration(delays: number[]) {
  for (const delay of delays) {
    window.setTimeout(hydrateContextMenu, delay)
  }
}

function hydrateContextMenu() {
  const menuList = getVisibleMenuList()

  if (!menuList || !activeTrackContext) {
    closeInjectedSubmenu()
    return
  }

  const signature = `${activeTrackContext.trackId}:${reorderExpanded}:${menuList.childElementCount}`
  if (
    signature === lastMenuSignature &&
    menuList.querySelector(`[${MENU_ATTR}]`)
  ) {
    return
  }

  injectReorderMenu(menuList)
  lastMenuSignature = signature
}

document.addEventListener(
  "contextmenu",
  (event) => {
    tryCaptureTrackContext(event.target)
    scheduleMenuHydration([0, 50, 150, 300, 500])
  },
  true
)

document.addEventListener(
  "pointerdown",
  (event) => {
    tryCaptureTrackContext(event.target)

    const submenuRoot = document.getElementById(SUBMENU_ROOT_ID)
    const target = event.target

    if (
      submenuRoot &&
      target instanceof Node &&
      !submenuRoot.contains(target) &&
      !(
        target instanceof Element &&
        target.closest(`[${REORDER_ITEM_ATTR}="root"]`)
      )
    ) {
      closeInjectedSubmenu()
    }
  },
  true
)

document.addEventListener(
  "click",
  (event) => {
    tryCaptureTrackContext(event.target)

    const moreButton =
      event.target instanceof Element
        ? event.target.closest('[data-testid="more-button"]')
        : null

    if (moreButton) {
      scheduleMenuHydration([0, 60, 160, 320, 520])
    }
  },
  true
)

const observer = new MutationObserver(() => {
  hydrateContextMenu()
})

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
})

// ---------------------------------------------------------------------------
// Token capture — store Bearer tokens observed in fetch / XHR calls so the
// background webRequest listener (the primary path) has a content-side backup.
// Note: this overrides the content-script's own fetch/XHR, not the page's.
// The background webRequest listener captures page-level requests as well.
// ---------------------------------------------------------------------------

const _originalFetch = window.fetch.bind(window)
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const options = args[1]
  const headers = options?.headers

  if (headers) {
    const isHeaders = headers instanceof Headers
    const auth: string | null | undefined = isHeaders
      ? headers.get("authorization") ?? headers.get("Authorization")
      : (headers as Record<string, string>)?.["Authorization"] ??
        (headers as Record<string, string>)?.["authorization"]
    const clientTok: string | null | undefined = isHeaders
      ? headers.get("client-token")
      : (headers as Record<string, string>)?.["client-token"]

    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      chrome.storage.local.set({
        capturedAccessToken: auth.replace("Bearer ", "")
      })
    }
    if (typeof clientTok === "string" && clientTok) {
      chrome.storage.local.set({ capturedClientToken: clientTok })
    }
  }

  return _originalFetch(...args)
}

const _originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
XMLHttpRequest.prototype.setRequestHeader = function (
  this: XMLHttpRequest,
  header: string,
  value: string
) {
  if (header === "Authorization" && value.startsWith("Bearer ")) {
    chrome.storage.local.set({
      capturedAccessToken: value.replace("Bearer ", "")
    })
  }
  if (header === "client-token" && value) {
    chrome.storage.local.set({ capturedClientToken: value })
  }
  return _originalSetRequestHeader.call(this, header, value)
}

// ---------------------------------------------------------------------------
// Message handlers — used by the popup to check connectivity and read tokens
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ message: "Pong from content script" })
    return false
  }

  if (message?.type === "GET_TOKENS") {
    chrome.storage.local.get(
      ["capturedAccessToken", "capturedClientToken"],
      (result) => {
        sendResponse({
          accessToken: result.capturedAccessToken ?? null,
          clientToken: result.capturedClientToken ?? null
        })
      }
    )
    return true // keep channel open for async response
  }
})

// ---------------------------------------------------------------------------
// Receive fetchPlaylistContents data dispatched by the page-world script.
// CustomEvents on window are visible across JS worlds (page → content script).
// ---------------------------------------------------------------------------

type InterceptedTrack = {
  uid: string
  name: string
  uri: string
  id: string
  trackNumber?: number
}

type SpoTracksDetail = {
  playlistUri: string
  offset: number
  tracks: InterceptedTrack[]
  complete: boolean
  totalCount?: number
}

window.addEventListener("__spo_tracks__", (event) => {
  const detail = (event as CustomEvent<SpoTracksDetail>).detail
  console.log("[SPO:content] __spo_tracks__ received", detail)

  // Basic validation — never trust data from the page world without checking
  if (
    !detail ||
    typeof detail.playlistUri !== "string" ||
    !detail.playlistUri.startsWith("spotify:playlist:") ||
    !Array.isArray(detail.tracks)
  ) {
    return
  }

  const playlistId = detail.playlistUri.split(":").pop() ?? ""
  if (!/^[A-Za-z0-9]+$/.test(playlistId)) return

  const total = detail.totalCount

  const safeTracks = detail.tracks
    .filter(
      (t) =>
        t &&
        typeof t.uid === "string" &&
        typeof t.name === "string" &&
        t.name.length > 0 &&
        t.name.length <= 500 &&
        (total == null ||
          typeof t.trackNumber !== "number" ||
          t.trackNumber <= total)
    )
    .map((t, i) => ({
      uid: t.uid,
      name: t.name,
      uri: typeof t.uri === "string" ? t.uri : "",
      id: typeof t.id === "string" ? t.id : "",
      trackNumber:
        typeof t.trackNumber === "number" ? t.trackNumber : undefined,
      position: detail.offset + i
    }))

  /** Merge an incoming batch into an existing track array, keyed on uid. */
  function mergeByUid(
    existing: typeof safeTracks,
    incoming: typeof safeTracks
  ): typeof safeTracks {
    const seen = new Map<string, (typeof safeTracks)[number]>()
    for (const t of existing) seen.set(t.uid, t)
    // Incoming pages overwrite stale position data for the same uid
    for (const t of incoming) seen.set(t.uid, t)
    return Array.from(seen.values()).sort((a, b) => a.position - b.position)
  }

  console.log(
    `[SPO:content] storing ${safeTracks.length} safe tracks, offset=${detail.offset}`
  )
  if (detail.offset === 0) {
    // Fresh playlist load — replace stored tracks
    chrome.storage.local.set({
      interceptedPlaylist: {
        id: playlistId,
        uri: detail.playlistUri,
        tracks: safeTracks,
        complete: detail.complete,
        totalCount: total
      }
    })
  } else {
    // Subsequent page — merge into existing store (no duplicates)
    chrome.storage.local.get(["interceptedPlaylist"], (result) => {
      const existing = result.interceptedPlaylist as
        | {
            id: string
            uri: string
            tracks: typeof safeTracks
            complete: boolean
            totalCount?: number
          }
        | undefined

      if (!existing || existing.id !== playlistId) return

      chrome.storage.local.set({
        interceptedPlaylist: {
          ...existing,
          tracks: mergeByUid(existing.tracks, safeTracks),
          complete: detail.complete,
          totalCount: total ?? existing.totalCount
        }
      })
    })
  }
})
