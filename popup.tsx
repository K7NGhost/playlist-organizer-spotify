import { useEffect, useState } from "react"
import logo from "data-base64:~assets/logo.png"

const CLIENT_ID = "9a009d1f37a6430fac6446d53dc0999a"
const REDIRECT_PATH = "spotify"
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public"
]

const pageStyle = {
  width: 380,
  minHeight: 560,
  margin: 0,
  padding: 16,
  boxSizing: "border-box" as const,
  fontFamily:
    '"Segoe UI", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif',
  color: "#f7f7f7",
  background: "linear-gradient(180deg, #0b0b0b 0%, #050505 100%)"
}

const cardStyle = {
  position: "relative" as const,
  minHeight: "100%",
  background:
    "radial-gradient(circle at top left, rgba(29, 185, 84, 0.28) 0%, rgba(22, 22, 22, 0.98) 34%, rgba(8, 8, 8, 1) 100%)",
  borderRadius: 34,
  padding: "22px 20px 24px",
  boxShadow: "0 22px 55px rgba(0, 0, 0, 0.42)"
}

const connectButtonStyle = {
  position: "relative" as const,
  zIndex: 1,
  width: "100%",
  border: "none",
  borderRadius: 999,
  padding: "14px 18px",
  background: "#1db954",
  color: "#08140d",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer"
}

const secondaryButtonStyle = {
  ...connectButtonStyle,
  background: "rgba(255, 255, 255, 0.08)",
  color: "#f7f7f7"
}

const statusBoxStyle = {
  position: "relative" as const,
  zIndex: 1,
  marginBottom: 18,
  padding: "12px 14px",
  borderRadius: 16,
  background: "rgba(255, 255, 255, 0.06)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "rgba(255, 255, 255, 0.82)"
}

type AuthState = {
  accessToken?: string
  expiresAt?: number
  refreshToken?: string
}

function getExtensionApis() {
  try {
    return {
      identity: globalThis.chrome?.identity,
      storage: globalThis.chrome?.storage?.local
    }
  } catch {
    return {
      identity: undefined,
      storage: undefined
    }
  }
}

function getRedirectUri() {
  try {
    return getExtensionApis().identity?.getRedirectURL(REDIRECT_PATH) ?? null
  } catch {
    return null
  }
}

function randomString(length: number) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  const values = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(values, (value) => chars[value % chars.length]).join("")
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest("SHA-256", data)
}

function base64UrlEncode(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function exchangeCodeForToken(code: string, codeVerifier: string) {
  const { identity } = getExtensionApis()

  if (!identity) {
    throw new Error("chrome.identity is unavailable. Reload the extension and open the popup from Chrome.")
  }

  const redirectUri = identity.getRedirectURL(REDIRECT_PATH)

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${await response.text()}`)
  }

  return response.json()
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
    throw new Error(`Token refresh failed: ${await response.text()}`)
  }

  return response.json()
}

function formatExpiry(expiresAt?: number) {
  if (!expiresAt) return "Unknown"

  const minutes = Math.max(0, Math.floor((expiresAt - Date.now()) / 60000))
  return `${minutes} min`
}

function IndexPopup() {
  const [authState, setAuthState] = useState<AuthState>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [redirectUri, setRedirectUri] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState(
    "Waiting for Spotify connection."
  )

  useEffect(() => {
    setRedirectUri(getRedirectUri())

    void loadStoredAuth().catch((error) => {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Failed to load the Spotify extension state."
      )
      setIsLoading(false)
    })
  }, [])

  const loadStoredAuth = async () => {
    const { storage } = getExtensionApis()

    if (!storage) {
      setStatusMessage(
        "chrome.storage is unavailable. Reload the extension from chrome://extensions before testing OAuth."
      )
      setIsLoading(false)
      return
    }

    const stored = await storage.get([
      "spotify_access_token",
      "spotify_refresh_token",
      "spotify_expires_at"
    ])

    const nextState = {
      accessToken: stored.spotify_access_token as string | undefined,
      refreshToken: stored.spotify_refresh_token as string | undefined,
      expiresAt: stored.spotify_expires_at as number | undefined
    }

    setAuthState(nextState)

    if (nextState.accessToken && nextState.expiresAt && nextState.expiresAt > Date.now()) {
      setStatusMessage("Spotify is connected. You can start wiring playlist actions next.")
    } else if (nextState.refreshToken) {
      setStatusMessage("Stored Spotify session found. Refresh before making playlist calls.")
    }

    setIsLoading(false)
  }

  const connectToSpotify = async () => {
    try {
      const { identity, storage } = getExtensionApis()

      if (!identity || !storage) {
        throw new Error(
          "Required Chrome extension APIs are unavailable. Reload the extension and open this popup from the extension icon."
        )
      }

      setIsConnecting(true)
      setStatusMessage("Opening Spotify sign-in...")

      const redirectUri = identity.getRedirectURL(REDIRECT_PATH)
      const codeVerifier = randomString(64)
      const codeChallenge = base64UrlEncode(await sha256(codeVerifier))
      const state = randomString(16)

      const authUrl = new URL("https://accounts.spotify.com/authorize")
      authUrl.search = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
        state,
        scope: SCOPES.join(" ")
      }).toString()

      const responseUrl = await identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      })

      if (!responseUrl) {
        throw new Error("Spotify login did not return a redirect URL.")
      }

      const params = new URL(responseUrl).searchParams
      const code = params.get("code")
      const returnedState = params.get("state")
      const authError = params.get("error")

      if (authError) {
        throw new Error(`Spotify authorization failed: ${authError}`)
      }

      if (!code || returnedState !== state) {
        throw new Error("Spotify authorization returned an invalid code or state.")
      }

      setStatusMessage("Exchanging Spotify code for tokens...")

      const tokenData = await exchangeCodeForToken(code, codeVerifier)
      const expiresAt = Date.now() + tokenData.expires_in * 1000

      await storage.set({
        spotify_access_token: tokenData.access_token,
        spotify_refresh_token: tokenData.refresh_token,
        spotify_expires_at: expiresAt
      })

      setAuthState({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt
      })
      setStatusMessage("Spotify connected successfully.")
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Spotify connection failed."
      )
    } finally {
      setIsConnecting(false)
    }
  }

  const refreshSession = async () => {
    if (!authState.refreshToken) {
      setStatusMessage("No Spotify refresh token is stored yet.")
      return
    }

    try {
      const { storage } = getExtensionApis()

      if (!storage) {
        throw new Error("chrome.storage is unavailable. Reload the extension and try again.")
      }

      setIsConnecting(true)
      setStatusMessage("Refreshing Spotify session...")

      const refreshed = await refreshAccessToken(authState.refreshToken)
      const expiresAt = Date.now() + refreshed.expires_in * 1000

      await storage.set({
        spotify_access_token: refreshed.access_token,
        spotify_expires_at: expiresAt,
        ...(refreshed.refresh_token
          ? { spotify_refresh_token: refreshed.refresh_token }
          : {})
      })

      setAuthState((current) => ({
        accessToken: refreshed.access_token,
        expiresAt,
        refreshToken: refreshed.refresh_token ?? current.refreshToken
      }))
      setStatusMessage("Spotify session refreshed.")
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Spotify refresh failed."
      )
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnectSpotify = async () => {
    const { storage } = getExtensionApis()

    if (!storage) {
      setStatusMessage("chrome.storage is unavailable. Reload the extension and try again.")
      return
    }

    await storage.remove([
      "spotify_access_token",
      "spotify_refresh_token",
      "spotify_expires_at"
    ])

    setAuthState({})
    setStatusMessage("Stored Spotify tokens cleared from the extension.")
  }

  const isConnected =
    Boolean(authState.accessToken) &&
    Boolean(authState.expiresAt) &&
    (authState.expiresAt ?? 0) > Date.now()

  return (
    <div style={pageStyle}>
      <style>{`
        html, body {
          margin: 0;
          padding: 0;
          background: #090909;
        }
      `}</style>
      <div style={cardStyle}>
        <div
          style={{
            position: "absolute",
            bottom: 22,
            left: 28,
            width: 34,
            height: 34,
            background: "rgba(10, 10, 10, 0.98)",
            borderRadius: "0 0 10px 0",
            transform: "rotate(45deg)",
            boxShadow: "12px 12px 24px rgba(0, 0, 0, 0.18)",
            zIndex: 0
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: 52,
            height: 52,
            borderRadius: 16,
            display: "grid",
            placeItems: "center",
            background: "transparent",
            overflow: "hidden",
            marginBottom: 18
          }}>
          <img
            alt="Playlist organizer for Spotify logo"
            src={logo}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block"
            }}
          />
        </div>

        <p
          style={{
            position: "relative",
            zIndex: 1,
            margin: 0,
            fontSize: 12,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.58)"
          }}>
          Playlist Organizer For Spotify
        </p>

        <h1
          style={{
            position: "relative",
            zIndex: 1,
            margin: "10px 0 12px",
            fontSize: 29,
            lineHeight: 1.05
          }}>
          {isConnected ? "Spotify connected" : "Connect your Spotify account"}
        </h1>

        <p
          style={{
            position: "relative",
            zIndex: 1,
            margin: "0 0 18px",
            color: "rgba(255, 255, 255, 0.78)",
            fontSize: 14,
            lineHeight: 1.5
          }}>
          {isConnected
            ? "Your extension can now request playlist data and reorder tracks on your behalf."
            : "Sign in with Spotify so this extension can move songs to the top or bottom of your playlists."}
        </p>

        <div style={statusBoxStyle}>
          <div>{statusMessage}</div>
          <div
            style={{
              marginTop: 6,
              color: "rgba(255, 255, 255, 0.64)",
              overflowWrap: "anywhere",
              wordBreak: "break-word"
            }}>
            Redirect URI: {redirectUri ?? "Unavailable until extension APIs load"}
          </div>
          <div style={{ marginTop: 6, color: "rgba(255, 255, 255, 0.64)" }}>
            Token expires in: {formatExpiry(authState.expiresAt)}
          </div>
        </div>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gap: 10,
            marginBottom: 18
          }}>
          {[
            "Read your playlists",
            "Reorder songs in playlists you can edit",
            "Use Spotify login without asking for your password"
          ].map((item) => (
            <div
              key={item}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                background: "rgba(255, 255, 255, 0.05)"
              }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "rgba(30, 215, 96, 0.15)",
                  color: "#1ed760",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0
                }}>
                ✓
              </span>
              <span style={{ fontSize: 13, color: "rgba(255, 255, 255, 0.88)" }}>
                {item}
              </span>
            </div>
          ))}
        </div>

        <button
          disabled={isLoading || isConnecting}
          onClick={connectToSpotify}
          style={{
            ...connectButtonStyle,
            opacity: isLoading || isConnecting ? 0.7 : 1
          }}
          type="button">
          {isConnecting ? "Connecting..." : isConnected ? "Reconnect Spotify" : "Continue with Spotify"}
        </button>

        <div
          style={{
            position: "relative",
            zIndex: 1,
            display: "grid",
            gap: 10,
            marginTop: 10
          }}>
          <button
            disabled={isLoading || isConnecting || !authState.refreshToken}
            onClick={refreshSession}
            style={{
              ...secondaryButtonStyle,
              opacity: isLoading || isConnecting || !authState.refreshToken ? 0.55 : 1
            }}
            type="button">
            Refresh session
          </button>

          <button
            disabled={isLoading || isConnecting}
            onClick={disconnectSpotify}
            style={{
              ...secondaryButtonStyle,
              background: "rgba(255, 255, 255, 0.04)",
              opacity: isLoading || isConnecting ? 0.55 : 1
            }}
            type="button">
            Clear stored tokens
          </button>
        </div>

        <p
          style={{
            position: "relative",
            zIndex: 1,
            margin: "14px 0 0",
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(255, 255, 255, 0.58)"
          }}>
          Spotify will show the consent screen in a browser window. This extension only
          requests playlist read and playlist modify permissions.
        </p>
      </div>
    </div>
  )
}

export default IndexPopup
