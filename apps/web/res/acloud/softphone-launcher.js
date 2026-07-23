(function () {
  if (window.top !== window.self) return;
  if (document.getElementById("akgun-softphone-launcher")) return;
  const ASSET_VERSION = "20260722-22";
  const ACLOUD_ORIGIN = "https://im.acloud.tr";
  const IS_DESKTOP = window.location.protocol === "vector:";
  const SERVICE_ORIGIN = IS_DESKTOP ? ACLOUD_ORIGIN : window.location.origin;
  const MATRIX_USERS_ENDPOINT = `${SERVICE_ORIGIN}/softphone/api/matrix-users`;
  const SIP_PROFILE_ENDPOINT = `${SERVICE_ORIGIN}/softphone/api/sip-profile`;
  const DIRECTORY_REFRESH_MS = 5 * 60 * 1000;
  const SIP_AUTH_MESSAGE = "SIP için yetkilerinizi kontrol ettiriniz.";

  const root = document.createElement("div");
  root.id = "akgun-softphone-launcher";
  root.innerHTML = `
    <div class="mx_RightPanel_ResizeWrapper akgun-softphone-rightpanel-wrapper" id="akgun-softphone-rightpanel-wrapper" hidden style="position: relative; user-select: auto; width: 208px; min-width: 192px; max-width: 272px; height: 100%; box-sizing: border-box; flex-shrink: 0; flex-basis: 208px;">
      <aside class="mx_RightPanel akgun-softphone-panel" id="akgun-softphone-panel" aria-label="Caller">
        <div class="mx_BaseCard akgun-softphone-card">
          <div class="mx_BaseCard_header akgun-softphone-head">
            <div class="akgun-softphone-head-copy">
              <strong>Caller</strong>
              <span>Kurumsal arama paneli</span>
            </div>
            <button type="button" class="_icon-button_1215g_8 akgun-softphone-close" id="akgun-softphone-close" aria-label="Kapat" data-kind="secondary">
              <div class="_indicator-icon_147l5_17" style="--cpd-icon-button-size: 100%;">
                <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6.293 6.293a1 1 0 0 1 1.414 0L12 10.586l4.293-4.293a1 1 0 1 1 1.414 1.414L13.414 12l4.293 4.293a1 1 0 0 1-1.414 1.414L12 13.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L10.586 12 6.293 7.707a1 1 0 0 1 0-1.414"></path>
                </svg>
              </div>
            </button>
          </div>
          <iframe
            id="akgun-softphone-frame"
            class="akgun-softphone-frame"
            src="${SERVICE_ORIGIN}/softphone/widget/?v=${ASSET_VERSION}"
            title="Akgun Dialer Widget"
            allow="microphone; autoplay"
            referrerpolicy="no-referrer"
          ></iframe>
        </div>
      </aside>
      <div>
        <div class="mx_ResizeHandle--horizontal akgun-softphone-resize-handle" aria-hidden="true"></div>
      </div>
    </div>
    <div class="akgun-sip-auth-modal" id="akgun-sip-auth-modal" role="presentation" hidden>
      <div class="akgun-sip-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="akgun-sip-auth-title" aria-describedby="akgun-sip-auth-description">
        <strong id="akgun-sip-auth-title">SIP yetkisi gerekli</strong>
        <p id="akgun-sip-auth-description">${SIP_AUTH_MESSAGE}</p>
        <button type="button" id="akgun-sip-auth-close">Tamam</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const panel = document.getElementById("akgun-softphone-panel");
  const panelWrapper = document.getElementById("akgun-softphone-rightpanel-wrapper");
  const closeBtn = document.getElementById("akgun-softphone-close");
  const frame = document.getElementById("akgun-softphone-frame");
  const resizeHandle = panelWrapper.querySelector(".akgun-softphone-resize-handle");
  const sipAuthModal = document.getElementById("akgun-sip-auth-modal");
  const sipAuthClose = document.getElementById("akgun-sip-auth-close");
  const PANEL_WIDTH_KEY = "akgun.softphone.panelWidth";
  const DEFAULT_PANEL_WIDTH = 208;
  const MIN_PANEL_WIDTH = 192;
  const MAX_PANEL_WIDTH = 272;
  let pendingDialRequest = null;
  let pendingDialAckKey = "";
  let pendingDialRetryTimer = null;
  let pendingDialRetryCount = 0;
  let activeCallContext = null;
  let cachedMatrixSession = null;
  let matrixSessionProbe = null;
  let sniffedAccessToken = "";
  let sniffedHomeserver = "";
  let panelShouldStayOpen = false;
  let panelKeepAliveUntil = 0;
  let widgetReady = false;
  let widgetRegistered = false;
  let sidebarEntry = null;
  let placementRetryTimer = null;
  let themeObserver = null;
  let lastThemeSignature = "";
  let directoryLoaded = false;
  let directoryLoading = false;
  let directoryLoadError = "";
  let directoryLastLoadedAt = 0;
  let directoryItems = [];
  let directoryLookup = new Map();
  let sipProfile = null;
  let sipProfileLoading = false;
  let sipProfileLoaded = false;
  let sipProfileRetryTimer = null;
  let lastMatrixSessionFingerprint = "";
  let sipProfileLastLoadedAt = 0;

  function pushDebugLog(message) {
    try {
      frame.contentWindow?.postMessage(
        {
          type: "akgun:debug-log",
          message: String(message || ""),
        },
        SERVICE_ORIGIN,
      );
    } catch (_error) {
    }
  }

  function formatDurationSeconds(totalSeconds) {
    const value = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function getElementMatrixClient() {
    const candidates = [
      window.matrixClient,
      window.mxClient,
      window.matrixChat?.matrixClient,
      window.matrixChat?.client,
      window.app?.matrixClient,
      window.__matrixClient,
    ];
    return candidates.find((candidate) => candidate && typeof candidate.getAccessToken === "function" && typeof candidate.getUserId === "function") || null;
  }

  function getStoredValue(key) {
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key) || "";
  }

  function isLikelyMatrixAccessToken(value) {
    return typeof value === "string" && /^syt_[A-Za-z0-9?._=-]{20,}$/.test(value.trim());
  }

  function isLikelyMatrixRequestUrl(requestUrl) {
    if (!requestUrl || typeof requestUrl !== "string") return false;
    try {
      const url = new URL(requestUrl, SERVICE_ORIGIN);
      return url.origin === SERVICE_ORIGIN && url.pathname.startsWith("/_matrix/");
    } catch (_error) {
      return false;
    }
  }

  function rememberMatrixAuth(authHeader, requestUrl) {
    if (!authHeader || typeof authHeader !== "string") return;
    if (!isLikelyMatrixRequestUrl(requestUrl)) return;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) return;
    const token = match[1].trim();
    if (!isLikelyMatrixAccessToken(token)) return;
    const tokenChanged = sniffedAccessToken !== token;
    sniffedAccessToken = token;
    try {
      sniffedHomeserver = new URL(requestUrl, SERVICE_ORIGIN).origin;
    } catch (_error) {
      sniffedHomeserver = SERVICE_ORIGIN;
    }
    if (cachedMatrixSession?.accessToken !== sniffedAccessToken) {
      cachedMatrixSession = null;
    }
    if (tokenChanged) {
      pushDebugLog("Launcher: Matrix bearer token yakalandi");
      if (widgetReady && !sipProfileLoaded) {
        scheduleSipProfileRetry(100);
      }
    }
  }

  function installMatrixAuthSniffer() {
    if (window.__akgunMatrixAuthSnifferInstalled) return;
    window.__akgunMatrixAuthSnifferInstalled = true;

    const originalFetch = window.fetch?.bind(window);
    if (originalFetch) {
      window.fetch = async (input, init) => {
        try {
          const url = typeof input === "string"
            ? input
            : (typeof URL !== "undefined" && input instanceof URL ? input.href : input?.url || "");
          const authHeader = init?.headers?.Authorization
            || init?.headers?.authorization
            || (typeof Headers !== "undefined" && init?.headers instanceof Headers ? init.headers.get("Authorization") : "")
            || (input?.headers && typeof input.headers.get === "function" ? input.headers.get("Authorization") : "");
          if (url && authHeader) {
            rememberMatrixAuth(authHeader, url);
          }
        } catch (_error) {
        }
        return originalFetch(input, init);
      };
    }

    const xhrProto = window.XMLHttpRequest?.prototype;
    if (xhrProto && !xhrProto.__akgunPatched) {
      xhrProto.__akgunPatched = true;
      const originalOpen = xhrProto.open;
      const originalSetRequestHeader = xhrProto.setRequestHeader;
      xhrProto.open = function(method, url, ...rest) {
        this.__akgunRequestUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      xhrProto.setRequestHeader = function(name, value) {
        try {
          if (String(name).toLowerCase() === "authorization") {
            rememberMatrixAuth(value, this.__akgunRequestUrl || SERVICE_ORIGIN);
          }
        } catch (_error) {
        }
        return originalSetRequestHeader.call(this, name, value);
      };
    }
  }

  function tryBuildSessionFromCandidate(candidate) {
    const accessToken = pickStringCandidate(candidate?.accessToken || candidate?.access_token || candidate?.token, [/^syt_[A-Za-z0-9?._=-]{20,}$/]);
    const userId = pickStringCandidate(candidate?.userId || candidate?.user_id || candidate?.mxid, [/^@.+:.+$/]);
    const homeserver = pickStringCandidate(candidate?.homeserver || candidate?.baseUrl || candidate?.hsUrl || candidate?.mx_hs_url, [/^https?:\/\//i]);
    if (!accessToken) return null;
    return {
      accessToken,
      userId,
      homeserver: homeserver || SERVICE_ORIGIN,
    };
  }

  function scanStorageObjectForSession(rawValue) {
    if (!rawValue) return null;
    const direct = tryBuildSessionFromCandidate(rawValue);
    if (direct) return direct;
    const bucket = collectSessionCandidates(rawValue, {});
    if (isLikelyMatrixAccessToken(bucket.accessToken || "")) {
      return {
        accessToken: bucket.accessToken,
        userId: bucket.userId || "",
        homeserver: bucket.homeserver || SERVICE_ORIGIN,
      };
    }
    return null;
  }

  function scanStorageForSession(storage) {
    if (!storage) return null;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const directText = scanStorageObjectForSession({ [key]: raw });
      if (directText?.accessToken) return directText;
      try {
        const parsed = JSON.parse(raw);
        const fromJson = scanStorageObjectForSession(parsed);
        if (fromJson?.accessToken) return fromJson;
      } catch (_error) {
      }
    }
    return null;
  }

  function getMatrixSessionFromStorage() {
    const directAccessToken = getStoredValue("mx_access_token");
    const directUserId = getStoredValue("mx_user_id");
    const directHomeserver = getStoredValue("mx_hs_url") || SERVICE_ORIGIN;
    if (isLikelyMatrixAccessToken(directAccessToken)) {
      pushDebugLog("Launcher: klasik mx_* oturum anahtarlari bulundu");
      return {
        accessToken: directAccessToken.trim(),
        userId: typeof directUserId === "string" ? directUserId.trim() : "",
        homeserver: directHomeserver,
      };
    }
    const fromLocal = scanStorageForSession(window.localStorage);
    if (fromLocal?.accessToken) return fromLocal;
    const fromSession = scanStorageForSession(window.sessionStorage);
    if (fromSession?.accessToken) return fromSession;
    return null;
  }

  function pickStringCandidate(value, patterns) {
    if (typeof value !== "string") return "";
    return patterns.some((pattern) => pattern.test(value)) ? value : "";
  }

  function collectSessionCandidates(source, bucket = {}) {
    if (!source || typeof source !== "object") return bucket;
    for (const [key, value] of Object.entries(source)) {
      const lowerKey = key.toLowerCase();
      if (!bucket.accessToken && (lowerKey.includes("access") && lowerKey.includes("token"))) {
        bucket.accessToken = typeof value === "string" ? value : bucket.accessToken;
      }
      if (!bucket.userId && ((lowerKey.includes("user") && lowerKey.includes("id")) || lowerKey === "userid")) {
        bucket.userId = pickStringCandidate(value, [/^@.+:.+$/]);
      }
      if (!bucket.homeserver && (lowerKey.includes("home") || lowerKey.includes("server") || lowerKey.includes("base"))) {
        bucket.homeserver = pickStringCandidate(value, [/^https?:\/\//i]);
      }
      if (value && typeof value === "object") {
        collectSessionCandidates(value, bucket);
      }
    }
    return bucket;
  }

  function openIndexedDb(name) {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function resolveWithTimeout(promise, timeoutMs, fallback = null) {
    return Promise.race([
      promise,
      new Promise((resolve) => {
        window.setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  }

  function readObjectStoreSnapshot(db, storeName) {
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const values = [];
        const request = store.openCursor();
        request.onerror = () => resolve(values);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || values.length >= 40) {
            resolve(values);
            return;
          }
          values.push(cursor.value);
          cursor.continue();
        };
      } catch (_error) {
        resolve([]);
      }
    });
  }

  async function findMatrixSessionInIndexedDb() {
    if (!window.indexedDB?.databases) return null;
    try {
      const databases = await window.indexedDB.databases();
      for (const databaseInfo of databases) {
        if (!databaseInfo?.name) continue;
        const db = await openIndexedDb(databaseInfo.name);
        try {
          for (const storeName of Array.from(db.objectStoreNames || [])) {
            const values = await readObjectStoreSnapshot(db, storeName);
            for (const value of values) {
              const candidate = collectSessionCandidates(value, {});
              if (candidate.accessToken && candidate.userId) {
                return {
                  accessToken: candidate.accessToken,
                  userId: candidate.userId,
                  homeserver: candidate.homeserver || SERVICE_ORIGIN,
                };
              }
            }
          }
        } finally {
          db.close();
        }
      }
    } catch (error) {
      console.warn("Caller IndexedDB session probe failed", error);
    }
    return null;
  }

  async function getMatrixSession() {
    if (cachedMatrixSession) return cachedMatrixSession;
    const client = getElementMatrixClient();
    if (client) {
      const fromClient = {
        accessToken: String(client.getAccessToken?.() || client.credentials?.accessToken || "").trim(),
        userId: String(client.getUserId?.() || client.credentials?.userId || "").trim(),
        homeserver: String(client.getHomeserverUrl?.() || client.baseUrl || SERVICE_ORIGIN).trim() || SERVICE_ORIGIN,
      };
      if (isLikelyMatrixAccessToken(fromClient.accessToken) && fromClient.userId) {
        cachedMatrixSession = fromClient;
        pushDebugLog(`Launcher: global client oturumu bulundu (${fromClient.userId})`);
        return cachedMatrixSession;
      }
    }
    const fromStorage = getMatrixSessionFromStorage();
    if (fromStorage?.accessToken) {
      pushDebugLog("Launcher: storage icinde Matrix oturumu bulundu");
      if (fromStorage.userId) {
        cachedMatrixSession = fromStorage;
        return cachedMatrixSession;
      }
      try {
        const response = await fetch(`${fromStorage.homeserver}/_matrix/client/v3/account/whoami`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${fromStorage.accessToken}`,
            Accept: "application/json",
          },
          credentials: "omit",
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json();
          fromStorage.userId = String(payload?.user_id || "").trim();
          if (fromStorage.userId) {
            cachedMatrixSession = fromStorage;
            pushDebugLog(`Launcher: storage oturumu dogrulandi (${fromStorage.userId})`);
            return cachedMatrixSession;
          }
        }
      } catch (_error) {
      }
    }
    if (sniffedAccessToken) {
      const sniffedSession = {
        accessToken: sniffedAccessToken,
        userId: "",
        homeserver: sniffedHomeserver || SERVICE_ORIGIN,
      };
      try {
        const response = await fetch(`${sniffedSession.homeserver}/_matrix/client/v3/account/whoami`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${sniffedSession.accessToken}`,
            Accept: "application/json",
          },
          credentials: "omit",
          cache: "no-store",
        });
        if (response.ok) {
          const payload = await response.json();
          sniffedSession.userId = String(payload?.user_id || "").trim();
        }
      } catch (_error) {
      }
      if (sniffedSession.userId) {
        cachedMatrixSession = sniffedSession;
        pushDebugLog(`Launcher: sniffed oturum dogrulandi (${sniffedSession.userId})`);
        return cachedMatrixSession;
      }
      pushDebugLog("Launcher: sniffed token dogrulanamadi");
      return null;
    }
    if (!matrixSessionProbe) {
      matrixSessionProbe = resolveWithTimeout(findMatrixSessionInIndexedDb(), 2500, null).then((session) => {
        if (session) {
          cachedMatrixSession = session;
          pushDebugLog(`Launcher: IndexedDB oturumu bulundu (${session.userId || "user?"})`);
        }
        return session;
      }).finally(() => {
        matrixSessionProbe = null;
      });
    }
    return matrixSessionProbe;
  }

  async function matrixJson(path, options = {}) {
    const session = await getMatrixSession();
    if (!session) {
      throw new Error("matrix_session_missing");
    }
    const response = await fetch(`${session.homeserver}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`matrix_http_${response.status}`);
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  async function authenticatedFetchJson(path) {
    const session = await getMatrixSession();
    if (!session?.accessToken) {
      throw new Error("matrix_session_missing");
    }
    if (!session?.userId) {
      throw new Error("matrix_session_unverified");
    }
    const response = await fetch(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }
    return response.json();
  }

  function canUseSip() {
    return !!sipProfile?.sipEnabled;
  }

  function showSipAuthorizationMessage() {
    if (!sipAuthModal) return;
    sipAuthModal.hidden = false;
    window.setTimeout(() => sipAuthClose?.focus(), 0);
  }

  function closeSipAuthorizationMessage() {
    if (!sipAuthModal) return;
    sipAuthModal.hidden = true;
    sidebarEntry?.focus();
  }

  sipAuthClose?.addEventListener("click", closeSipAuthorizationMessage);
  sipAuthModal?.addEventListener("click", (event) => {
    if (event.target === sipAuthModal) closeSipAuthorizationMessage();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sipAuthModal && !sipAuthModal.hidden) closeSipAuthorizationMessage();
  });

  function scheduleSipProfileRetry(delay = 1500) {
    if (sipProfileRetryTimer) return;
    sipProfileRetryTimer = window.setTimeout(() => {
      sipProfileRetryTimer = null;
      void ensureSipProfileLoaded(true);
    }, delay);
  }

  function pushSipProfileToWidget() {
    if (!frame.contentWindow || !widgetReady || !sipProfileLoaded) return;
    frame.contentWindow.postMessage(
      {
        type: "akgun:sip-profile",
        profile: sipProfile,
      },
      SERVICE_ORIGIN,
    );
  }

  function bootstrapLoadedWidget(reason) {
    widgetReady = true;
    lastThemeSignature = "";
    syncThemeToWidget();
    pushDebugLog(`Launcher: widget yuklendi (${reason})`);
    pushSipProfileToWidget();
    if (!sipProfileLoaded) {
      pushDebugLog("Launcher: SIP profili otomatik yukleniyor");
      void ensureSipProfileLoaded(true);
    }
    tryFlushPendingDialRequest();
  }

  async function ensureSipProfileLoaded(force = false) {
    if (!force && sipProfileLoaded) return sipProfile;
    if (sipProfileLoading) {
      if (!sipProfileLoaded) scheduleSipProfileRetry(500);
      return sipProfile;
    }
    sipProfileLoading = true;
    pushDebugLog("Launcher: SIP profili yukleniyor");
    try {
      const payload = await authenticatedFetchJson(SIP_PROFILE_ENDPOINT);
      const previousProfile = sipProfile;
      const nextProfile = payload && typeof payload === "object" ? payload : { sipEnabled: false };
      const unchangedEnabledProfile = !!(
        sipProfileLoaded
        && previousProfile?.sipEnabled
        && nextProfile.sipEnabled
        && previousProfile.sipExtension === nextProfile.sipExtension
        && previousProfile.sipUri === nextProfile.sipUri
        && previousProfile.sipWsUrl === nextProfile.sipWsUrl
        && previousProfile.sipPassword === nextProfile.sipPassword
      );
      if (unchangedEnabledProfile) {
        sipProfileLastLoadedAt = Date.now();
        pushDebugLog(`Launcher: SIP yetkisi yenilendi (${previousProfile.sipExtension})`);
        updateSidebarEntryState();
        return previousProfile;
      }
      sipProfile = nextProfile;
      if (sipProfile.sipEnabled) {
        try {
          const turnConfig = await matrixJson("/_matrix/client/v3/voip/turnServer");
          const urls = Array.isArray(turnConfig?.uris) ? turnConfig.uris : [];
          sipProfile.iceServers = urls.length ? [{
            urls,
            username: turnConfig.username || "",
            credential: turnConfig.password || "",
          }] : [];
          pushDebugLog(`Launcher: TURN profili alindi (${urls.length} URI)`);
        } catch (turnError) {
          sipProfile.iceServers = [];
          pushDebugLog(`Launcher: TURN profili alinamadi (${turnError?.message || "turn_error"})`);
        }
      }
      sipProfileLoaded = true;
      sipProfileLastLoadedAt = Date.now();
      pushDebugLog(`Launcher: SIP profili alindi (${sipProfile.sipExtension || "yok"})`);
      pushSipProfileToWidget();
      requestAnimationFrame(scanMenus);
      return sipProfile;
    } catch (error) {
      const message = error?.message || "sip_profile_load_failed";
      sipProfile = { sipEnabled: false, error: message };
      pushDebugLog(`Launcher: SIP profili alinamadi (${message})`);
      if (message === "matrix_session_missing" || message === "matrix_session_unverified" || message === "http_401" || message === "http_403") {
        sipProfileLoaded = false;
        if (message === "http_401" || message === "http_403") {
          cachedMatrixSession = null;
          pushDebugLog("Launcher: Matrix oturumu henuz hazir degil; tekrar denenecek");
        }
        scheduleSipProfileRetry();
        return sipProfile;
      }
      sipProfileLoaded = true;
      requestAnimationFrame(scanMenus);
      return sipProfile;
    } finally {
      sipProfileLoading = false;
    }
  }

  async function resolveDirectRoomId(targetMxid) {
    const client = getElementMatrixClient();
    if (client?.getAccountData) {
      try {
        const directEvent = client.getAccountData("m.direct");
        const content = directEvent?.getContent?.() || {};
        const roomIds = Array.isArray(content?.[targetMxid]) ? content[targetMxid] : [];
        if (roomIds[0]) {
          return roomIds[0];
        }
      } catch (error) {
        console.warn("Caller direct room lookup via client failed", error);
      }
    }
    const session = await getMatrixSession();
    if (!session || !targetMxid) return "";
    const payload = await matrixJson(`/_matrix/client/v3/user/${encodeURIComponent(session.userId)}/account_data/m.direct`);
    const roomIds = Array.isArray(payload?.[targetMxid]) ? payload[targetMxid] : [];
    return roomIds[0] || "";
  }

  async function sendRoomNotice(roomId, body) {
    if (!roomId || !body) return;
    const client = getElementMatrixClient();
    if (client?.sendMessage) {
      await client.sendMessage(roomId, null, {
        msgtype: "m.notice",
        body,
      });
      return;
    }
    const txnId = `akgun-call-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await matrixJson(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, {
      method: "PUT",
      body: {
        msgtype: "m.notice",
        body,
      },
    });
  }

  function openRoomById(roomId) {
    if (!roomId) return;
    const targetHash = `#/room/${encodeURIComponent(roomId)}`;
    if (window.location.hash === targetHash) return;
    window.location.hash = targetHash;
  }

  function activateRoomButton(roomButton) {
    if (!roomButton) return false;
    roomButton.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    roomButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    roomButton.click();
    return true;
  }

  function closeMenuTrigger(menuTrigger) {
    if (!menuTrigger) return;
    window.setTimeout(() => {
      try {
        const menuId = menuTrigger.getAttribute("aria-controls");
        const menu = menuId ? document.getElementById(menuId) : null;
        if (menu) {
          menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          menu.hidden = true;
          menu.style.display = "none";
          menu.setAttribute("data-state", "closed");
        }
        menuTrigger.setAttribute("aria-expanded", "false");
      } catch (_error) {
      }
    }, 0);
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function createCallContext(number, autoCall, meta = {}) {
    const context = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      number,
      autoCall: !!autoCall,
      targetMxid: meta.matrixUserId || "",
      targetName: meta.displayName || meta.localpart || number,
      roomButton: meta.roomButton || null,
      roomId: "",
      startedSent: false,
      finishedSent: false,
      roomPromise: null,
    };
    context.roomPromise = (async () => {
      if (!context.targetMxid) return "";
      try {
        const roomId = await resolveDirectRoomId(context.targetMxid);
        if (activeCallContext !== context) return "";
        context.roomId = roomId;
        return roomId;
      } catch (error) {
        console.warn("Caller room resolve failed", error);
        return "";
      }
    })();
    return context;
  }

  async function sendNoticeForContext(context, body) {
    if (!context || activeCallContext !== context) return;
    const roomId = context.roomId || await context.roomPromise;
    if (!roomId) return;
    try {
      await sendRoomNotice(roomId, body);
    } catch (error) {
      console.warn("Caller room notice failed", error);
    }
  }

  function handleWidgetCallState(data) {
    if (!activeCallContext) return;
    if (data.originator && data.originator !== "local") return;
    const context = activeCallContext;
    if (data.phase === "dialing" && !context.startedSent) {
      context.startedSent = true;
      void sendNoticeForContext(context, `☎ Arama başlatıldı: ${context.targetName} (${context.number})`);
      return;
    }
    if (data.phase === "ended" && !context.finishedSent) {
      context.finishedSent = true;
      const durationText = data.durationText || formatDurationSeconds(data.durationSeconds || 0);
      const body = (data.durationSeconds || 0) > 0
        ? `✓ Arama sona erdi • Süre: ${durationText}`
        : "✓ Arama sona erdi.";
      void sendNoticeForContext(context, body);
      activeCallContext = null;
      return;
    }
    if (data.phase === "failed" && !context.finishedSent) {
      context.finishedSent = true;
      void sendNoticeForContext(context, `✕ Arama sonuçlanmadı • Durum: ${data.failureText || "Bilinmeyen hata"}`);
      activeCallContext = null;
    }
  }

  function parseColorToRgb(value) {
    if (!value) return null;
    const probe = document.createElement("span");
    probe.style.color = value;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = window.getComputedStyle(probe).color;
    probe.remove();
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!match) return null;
    return {
      r: Number.parseInt(match[1], 10),
      g: Number.parseInt(match[2], 10),
      b: Number.parseInt(match[3], 10),
    };
  }

  function isDarkColor(value) {
    const rgb = parseColorToRgb(value);
    if (!rgb) return true;
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return luminance < 0.56;
  }

  function getThemeToken(styles, propertyName, fallback) {
    return styles.getPropertyValue(propertyName).trim() || fallback;
  }

  function findThemeSourceElement() {
    return document.querySelector(
      ".cpd-theme-dark, .cpd-theme-dark-hc, .cpd-theme-dark-custom, .cpd-theme-light, .cpd-theme-light-hc, .cpd-theme-light-custom",
    ) || document.body || document.documentElement;
  }

  function getThemeModeFromElement(element) {
    const classList = Array.from(element?.classList || []);
    if (classList.some((className) => className.startsWith("cpd-theme-dark"))) {
      return "dark";
    }
    if (classList.some((className) => className.startsWith("cpd-theme-light"))) {
      return "light";
    }
    return null;
  }

  function getCurrentThemePayload() {
    const themeElement = findThemeSourceElement();
    const themeStyles = window.getComputedStyle(themeElement);
    const docStyles = window.getComputedStyle(document.documentElement);
    const bodyStyles = window.getComputedStyle(document.body);
    const bgCanvas = getThemeToken(themeStyles, "--cpd-color-bg-canvas-default", getThemeToken(docStyles, "--cpd-color-bg-canvas-default", getThemeToken(bodyStyles, "--cpd-color-bg-canvas-default", "#09121a")));
    const bgSubtle = getThemeToken(themeStyles, "--cpd-color-bg-subtle-primary", getThemeToken(docStyles, "--cpd-color-bg-subtle-primary", getThemeToken(bodyStyles, "--cpd-color-bg-subtle-primary", "#132230")));
    const textPrimary = getThemeToken(themeStyles, "--cpd-color-text-primary", getThemeToken(docStyles, "--cpd-color-text-primary", getThemeToken(bodyStyles, "--cpd-color-text-primary", "#edf3f9")));
    const textSecondary = getThemeToken(themeStyles, "--cpd-color-text-secondary", getThemeToken(docStyles, "--cpd-color-text-secondary", getThemeToken(bodyStyles, "--cpd-color-text-secondary", "#98abbb")));
    const borderSecondary = getThemeToken(themeStyles, "--cpd-color-border-interactive-secondary", getThemeToken(docStyles, "--cpd-color-border-interactive-secondary", getThemeToken(bodyStyles, "--cpd-color-border-interactive-secondary", "#254051")));
    const accent = getThemeToken(themeStyles, "--cpd-color-icon-accent-primary", getThemeToken(docStyles, "--cpd-color-icon-accent-primary", getThemeToken(bodyStyles, "--cpd-color-icon-accent-primary", "#16c47f")));
    const accentAlt = getThemeToken(themeStyles, "--cpd-color-icon-info-primary", getThemeToken(docStyles, "--cpd-color-icon-info-primary", getThemeToken(bodyStyles, "--cpd-color-icon-info-primary", "#2a90ff")));
    const danger = getThemeToken(themeStyles, "--cpd-color-icon-critical-primary", getThemeToken(docStyles, "--cpd-color-icon-critical-primary", getThemeToken(bodyStyles, "--cpd-color-icon-critical-primary", "#ef5350")));
    const panelBg = bgSubtle || bgCanvas;
    const surfaceBg = getThemeToken(themeStyles, "--cpd-color-bg-subtle-secondary", getThemeToken(docStyles, "--cpd-color-bg-subtle-secondary", getThemeToken(bodyStyles, "--cpd-color-bg-subtle-secondary", panelBg)));
    const theme = getThemeModeFromElement(themeElement) || (isDarkColor(bgCanvas) ? "dark" : "light");
    return {
      type: "akgun:theme",
      theme,
      palette: {
        bgCanvas,
        bgSubtle,
        surfaceBg,
        panelBg,
        textPrimary,
        textSecondary,
        borderSecondary,
        accent,
        accentAlt,
        danger,
      },
    };
  }

  function getThemeSignature(payload) {
    return JSON.stringify({
      theme: payload.theme,
      palette: payload.palette,
    });
  }

  function syncThemeToWidget() {
    if (!frame.contentWindow) return;
    const payload = getCurrentThemePayload();
    const signature = getThemeSignature(payload);
    if (signature === lastThemeSignature && widgetReady) return;
    lastThemeSignature = signature;
    frame.contentWindow.postMessage(payload, SERVICE_ORIGIN);
  }

  function getMaxPanelWidth() {
    const container = findRightPanelContainer();
    const containerWidth = container?.clientWidth || window.innerWidth;
    return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, containerWidth - 160));
  }

  function clampPanelWidth(width) {
    return Math.min(getMaxPanelWidth(), Math.max(MIN_PANEL_WIDTH, Math.round(width)));
  }

  function setPanelWidth(width, persist = true) {
    const nextWidth = clampPanelWidth(width);
    panelWrapper.style.setProperty("width", `${nextWidth}px`, "important");
    panelWrapper.style.setProperty("min-width", `${MIN_PANEL_WIDTH}px`, "important");
    panelWrapper.style.setProperty("max-width", `${getMaxPanelWidth()}px`, "important");
    panelWrapper.style.setProperty("flex-basis", `${nextWidth}px`, "important");
    panelWrapper.style.setProperty("flex-shrink", "0", "important");
    if (persist) {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(nextWidth));
    }
  }

  function restorePanelWidth() {
    const stored = Number.parseInt(window.localStorage.getItem(PANEL_WIDTH_KEY) || "", 10);
    setPanelWidth(Number.isFinite(stored) ? stored : DEFAULT_PANEL_WIDTH, false);
  }

  function findRightPanelContainer() {
    const existingRightPanel = Array.from(document.querySelectorAll(".mx_RightPanel_ResizeWrapper"))
      .find((element) => element !== panelWrapper);
    if (existingRightPanel?.parentElement) {
      return existingRightPanel.parentElement;
    }

    const anchorSelectors = [
      ".mx_RoomView",
      ".mx_HomePage",
      ".mx_MatrixChat",
      "[role='main']",
      "#matrixchat > div",
      "#matrixchat",
    ];

    for (const selector of anchorSelectors) {
      const anchor = document.querySelector(selector);
      if (anchor?.parentElement) {
        const parentStyle = window.getComputedStyle(anchor.parentElement);
        if ((parentStyle.display === "flex" || parentStyle.display === "inline-flex") && parentStyle.flexDirection.startsWith("row")) {
          return anchor.parentElement;
        }
      }
    }

    const roomView = document.querySelector(".mx_RoomView, .mx_HomePage, .mx_MatrixChat, [role='main']");
    let node = roomView;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      if ((style.display === "flex" || style.display === "inline-flex") && style.flexDirection.startsWith("row")) {
        return node;
      }
      node = node.parentElement;
    }

    return null;
  }

  function ensurePanelPlacement() {
    const container = findRightPanelContainer();
    if (!container) {
      root.classList.add("akgun-softphone-docked");
      if (panelWrapper.parentElement !== root) {
        root.appendChild(panelWrapper);
      }
      return true;
    }
    root.classList.remove("akgun-softphone-docked");
    if (panelWrapper.parentElement !== container) {
      container.appendChild(panelWrapper);
    } else if (container.lastElementChild !== panelWrapper) {
      container.appendChild(panelWrapper);
    }
    return true;
  }

  function schedulePlacementRetry(attempt = 0) {
    if (placementRetryTimer) {
      window.clearTimeout(placementRetryTimer);
      placementRetryTimer = null;
    }
    if (attempt >= 12) return;
    placementRetryTimer = window.setTimeout(() => {
      const placed = ensurePanelPlacement();
      if (placed && !panelWrapper.hidden) {
        panelWrapper.hidden = false;
        return;
      }
      schedulePlacementRetry(attempt + 1);
    }, 150);
  }

  function openPanel() {
    if (sipProfileLoaded && !canUseSip()) {
      showSipAuthorizationMessage();
      closePanel();
      return;
    }
    panelShouldStayOpen = true;
    panelKeepAliveUntil = Date.now() + 2500;
    const placed = ensurePanelPlacement();
    panelWrapper.hidden = false;
    sidebarEntry?.setAttribute("aria-expanded", "true");
    sidebarEntry?.classList.add("akgun-caller-entry-active");
    syncThemeToWidget();
    if (!placed) {
      schedulePlacementRetry();
    }
  }

  function closePanel() {
    panelShouldStayOpen = false;
    panelKeepAliveUntil = 0;
    if (placementRetryTimer) {
      window.clearTimeout(placementRetryTimer);
      placementRetryTimer = null;
    }
    panelWrapper.hidden = true;
    sidebarEntry?.setAttribute("aria-expanded", "false");
    sidebarEntry?.classList.remove("akgun-caller-entry-active");
  }

  closeBtn.addEventListener("click", closePanel);

  function reopenPanelIfNeeded(delay = 0) {
    if (!panelShouldStayOpen) return;
    window.setTimeout(() => {
      if (!panelShouldStayOpen) return;
      openPanel();
    }, delay);
  }

  function reinforcePanelVisibility() {
    if (!panelShouldStayOpen) return;
    [0, 90, 220, 480, 900, 1500].forEach((delay) => {
      window.setTimeout(() => {
        if (!panelShouldStayOpen) return;
        if (panelKeepAliveUntil && Date.now() > panelKeepAliveUntil) return;
        openPanel();
      }, delay);
    });
  }

  function beginResize(startClientX) {
    const startWidth = panelWrapper.getBoundingClientRect().width;
    document.body.classList.add("akgun-softphone-resizing");

    const applyMove = (clientX) => {
      const delta = startClientX - clientX;
      setPanelWidth(startWidth + delta, false);
    };

    const stopResize = () => {
      document.body.classList.remove("akgun-softphone-resizing");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setPanelWidth(panelWrapper.getBoundingClientRect().width, true);
    };

    const onPointerMove = (moveEvent) => {
      applyMove(moveEvent.clientX);
    };

    const onPointerUp = () => {
      stopResize();
    };

    const onMouseMove = (moveEvent) => {
      applyMove(moveEvent.clientX);
    };

    const onMouseUp = () => {
      stopResize();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  resizeHandle?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizeHandle.setPointerCapture?.(event.pointerId);
    beginResize(event.clientX);
  });

  resizeHandle?.addEventListener("mousedown", (event) => {
    event.preventDefault();
    beginResize(event.clientX);
  });

  window.addEventListener("resize", () => {
    setPanelWidth(panelWrapper.getBoundingClientRect().width || DEFAULT_PANEL_WIDTH, false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panelWrapper.hidden) {
      closePanel();
    }
  });

  function tryFlushPendingDialRequest() {
    if (!pendingDialRequest || !widgetReady) return;
    frame.contentWindow?.postMessage(pendingDialRequest, SERVICE_ORIGIN);
  }

  function clearPendingDialRetry() {
    if (!pendingDialRetryTimer) return;
    window.clearTimeout(pendingDialRetryTimer);
    pendingDialRetryTimer = null;
  }

  function schedulePendingDialRetry() {
    clearPendingDialRetry();
    if (!pendingDialRequest || !widgetReady) return;
    if (pendingDialRetryCount >= 8) return;
    pendingDialRetryTimer = window.setTimeout(() => {
      pendingDialRetryTimer = null;
      pendingDialRetryCount += 1;
      tryFlushPendingDialRequest();
      schedulePendingDialRetry();
    }, pendingDialRetryCount < 2 ? 250 : 600);
  }

  async function dialFromElement(number, autoCall, meta = {}) {
    if (sipProfileLoaded && !canUseSip()) {
      showSipAuthorizationMessage();
      return;
    }
    closeMenuTrigger(meta.menuTrigger);
    const roomActivated = meta.roomButton ? activateRoomButton(meta.roomButton) : false;
    const callContext = createCallContext(number, autoCall, meta);
    activeCallContext = callContext;

    if (callContext.targetMxid) {
      try {
        const roomId = callContext.roomId || await callContext.roomPromise;
        if (activeCallContext !== callContext) return;
        if (roomId) {
          openRoomById(roomId);
          await sleep(180);
        } else if (roomActivated) {
          await sleep(120);
        }
      } catch (_error) {
        if (roomActivated) {
          await sleep(120);
        }
      }
    } else if (roomActivated) {
      await sleep(120);
    }

    if (activeCallContext !== callContext) return;
    openPanel();
    reinforcePanelVisibility();

    await sleep(120);
    if (activeCallContext !== callContext) return;

    pendingDialRequest = {
      type: "akgun:dial",
      number,
      autoCall: !!autoCall,
    };
    pendingDialAckKey = `${number}|${autoCall ? "1" : "0"}`;
    pendingDialRetryCount = 0;
    tryFlushPendingDialRequest();
    schedulePendingDialRetry();
  }

  function normalizeMatchText(value) {
    return (value || "")
      .toString()
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[ç]/g, "c")
      .replace(/[ğ]/g, "g")
      .replace(/[ı]/g, "i")
      .replace(/[ö]/g, "o")
      .replace(/[ş]/g, "s")
      .replace(/[ü]/g, "u")
      .replace(/\s+/g, " ");
  }

  function buildDirectoryLookup(items) {
    const collisions = new Set();
    const lookup = new Map();
    items.forEach((item) => {
      const keys = [
        item.displayName,
        item.localpart,
        `@${item.localpart}`,
      ]
        .map((value) => normalizeMatchText(value))
        .filter(Boolean);
      keys.forEach((key) => {
        if (collisions.has(key)) return;
        if (lookup.has(key)) {
          lookup.delete(key);
          collisions.add(key);
          return;
        }
        lookup.set(key, item);
      });
    });
    return lookup;
  }

  async function ensureMatrixDirectoryLoaded(force = false) {
    const now = Date.now();
    if (!force && directoryLoaded && now - directoryLastLoadedAt < DIRECTORY_REFRESH_MS) {
      return;
    }
    if (directoryLoading) return;
    directoryLoading = true;
    try {
      const payload = await authenticatedFetchJson(MATRIX_USERS_ENDPOINT);
      directoryItems = Array.isArray(payload.users) ? payload.users : [];
      directoryLookup = buildDirectoryLookup(directoryItems);
      directoryLoaded = true;
      directoryLoadError = "";
      directoryLastLoadedAt = now;
      requestAnimationFrame(scanMenus);
    } catch (error) {
      directoryLoadError = error?.message || "directory_load_failed";
    } finally {
      directoryLoading = false;
    }
  }

  function getMatchingDialAction(container) {
    const text = (container?.textContent || "").trim();
    if (!text) return null;
    const item = directoryLookup.get(normalizeMatchText(text));
    if (!item) return null;
    const targets = Array.isArray(item.targets) && item.targets.length
      ? item.targets
      : [{ number: item.number, label: item.numberLabel || "Hat", display: item.number }];
    return {
      matrixUserId: item.localpart ? `@${item.localpart}:im.acloud.tr` : "",
      localpart: item.localpart || "",
      displayName: item.displayName || item.localpart || text,
      actions: targets
        .filter((target) => target?.number)
        .map((target) => ({
          label: `${target.label ? `${target.label}: ` : ""}${target.display || target.number}`,
          number: target.number,
        })),
    };
  }

  function getActionFromMenu(menu) {
    const menuId = menu.id;
    if (!menuId) return null;
    const trigger = document.querySelector(`button[aria-label="More Options"][aria-controls="${menuId}"]`);
    if (!trigger) return null;
    const tile = trigger.closest('._container_rtaba_46, [data-testid="room-name"]')?.parentElement
      || trigger.closest('._container_rtaba_46')
      || trigger.closest('[role="treeitem"]')
      || trigger.parentElement?.parentElement?.parentElement;
    if (!tile) return null;
    const roomTreeItem = tile.closest('[role="treeitem"]') || tile;
    const roomButton = Array.from(roomTreeItem.querySelectorAll('[role="button"], button'))
      .find((button) => button !== trigger && button.getAttribute("aria-label") !== "More Options" && button.getAttribute("aria-label") !== "Notification options")
      || null;
    const roomNameEl = tile.querySelector('[data-testid="room-name"]');
    const roomContext = roomNameEl ? getMatchingDialAction(roomNameEl) : getMatchingDialAction(tile);
    if (!roomContext) return null;
    return {
      ...roomContext,
      roomButton,
      menuTrigger: trigger,
    };
  }

  function ensureMenuCallAction(menu) {
    if (!menu || menu.dataset.akgunCallBound === "1" || menu.querySelector(".akgun-call-action")) return;
    const roomContext = getActionFromMenu(menu);
    const actions = roomContext?.actions || [];
    if (!actions.length) return;
    menu.dataset.akgunCallBound = "1";
    const firstButton = menu.querySelector('button[role="menuitem"], button[role="menuitemcheckbox"]');
    actions.forEach((action, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.className = `${firstButton?.className || "akgun-call-action"} akgun-call-action`;
      button.dataset.kind = "primary";
      button.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24" class="_icon_lqfwq_50" aria-hidden="true">
          <path d="M6.62 10.79a15.46 15.46 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24 11.3 11.3 0 0 0 3.55.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 5a1 1 0 0 1 1-1h3.49a1 1 0 0 1 1 1 11.3 11.3 0 0 0 .57 3.55 1 1 0 0 1-.24 1Z"></path>
        </svg>
        <span class="_typography_6v6n8_153 _font-body-md-medium_6v6n8_60 _label_lqfwq_34">${action.label}</span>
      `;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        dialFromElement(action.number, true, roomContext);
      });
      if (index === 0) {
        const separator = menu.querySelector('[role="separator"]');
        if (separator) {
          separator.before(button);
          return;
        }
      }
      menu.appendChild(button);
    });
  }

  function ensureSidebarEntry() {
    const spacePanel = document.querySelector(".mx_SpacePanel");
    const threadsContainer = document.querySelector(".mx_ThreadsActivityCentre_container");
    if (!spacePanel || !threadsContainer) return;

    const expanded = !spacePanel.classList.contains("collapsed");

    if (!sidebarEntry || !sidebarEntry.isConnected) {
      const container = document.createElement("div");
      container.className = "akgun-caller-entry-container";
      container.innerHTML = `
        <button type="button" id="akgun-caller-entry" class="_icon-button_1215g_8 akgun-caller-entry" aria-label="Caller" aria-expanded="false" data-kind="primary">
          <div class="_indicator-icon_147l5_17" style="--cpd-icon-button-size: 100%;">
            <svg viewBox="0 0 24 24" focusable="false" class="akgun-caller-entry-icon">
              <path d="M6.62 10.79a15.46 15.46 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24 11.3 11.3 0 0 0 3.55.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 5a1 1 0 0 1 1-1h3.49a1 1 0 0 1 1 1 11.3 11.3 0 0 0 .57 3.55 1 1 0 0 1-.24 1Z"></path>
            </svg>
            <span title="Caller" class="_typography_6v6n8_153 _font-body-md-regular_6v6n8_50 akgun-caller-entry-label">Caller</span>
          </div>
        </button>
      `;
      const entry = container.querySelector("#akgun-caller-entry");
      entry?.addEventListener("click", () => {
        if (sipProfileLoaded && !canUseSip()) {
          showSipAuthorizationMessage();
          closePanel();
          return;
        }
        if (panelWrapper.hidden) {
          openPanel();
          return;
        }
        closePanel();
      });
      threadsContainer.parentElement?.insertBefore(container, threadsContainer);
      sidebarEntry = entry;
    }

    const container = sidebarEntry?.parentElement;
    if (!container) return;

    container.classList.toggle("expanded", expanded);
    container.classList.toggle("collapsed", !expanded);
    sidebarEntry.classList.toggle("expanded", expanded);
    sidebarEntry.classList.toggle("collapsed", !expanded);
    sidebarEntry.style.setProperty("--cpd-icon-button-size", "32px");
    sidebarEntry.setAttribute("aria-label", expanded ? "Caller" : "Caller");
    const label = sidebarEntry.querySelector(".akgun-caller-entry-label");
    if (label) {
      label.hidden = !expanded;
    }
    updateSidebarEntryState();
  }

  function updateSidebarEntryState() {
    if (!sidebarEntry) return;
    const unauthorized = sipProfileLoaded && !canUseSip();
    const statusText = unauthorized ? SIP_AUTH_MESSAGE : widgetRegistered ? "SIP register oldu" : sipProfileLoaded ? "SIP register değil" : "SIP durumu kontrol ediliyor";
    sidebarEntry.classList.toggle("akgun-caller-entry-registered", !!widgetRegistered);
    sidebarEntry.classList.toggle("akgun-caller-entry-unregistered", !widgetRegistered && !unauthorized);
    sidebarEntry.classList.toggle("akgun-caller-entry-unauthorized", unauthorized);
    sidebarEntry.setAttribute("title", unauthorized ? "Caller" : `Caller • ${statusText}`);
    sidebarEntry.setAttribute("aria-label", unauthorized ? `Caller. ${SIP_AUTH_MESSAGE}` : "Caller");
    sidebarEntry.setAttribute("data-status-text", statusText);
  }

  let menuScanQueued = false;

  function defaultSpotlightToPeople() {
    const dialog = document.querySelector(".mx_SpotlightDialog");
    if (!dialog || dialog.dataset.akgunPeopleDefaultApplied === "1") return;
    const peopleButton = dialog.querySelector("#mx_SpotlightDialog_button_startChat");
    const genericSearchMarker = dialog.querySelector("#mx_SpotlightDialog_button_searchMessages");
    if (!peopleButton || !genericSearchMarker) return;
    dialog.dataset.akgunPeopleDefaultApplied = "1";
    peopleButton.click();
    window.requestAnimationFrame(() => {
      dialog.querySelector(".mx_SpotlightDialog_searchBox input")?.focus();
    });
  }

  function scanMenus() {
    menuScanQueued = false;
    defaultSpotlightToPeople();
    ensureSidebarEntry();
    if (!sipProfileLoaded) {
      void ensureSipProfileLoaded();
      return;
    }
    updateSidebarEntryState();
    if (!canUseSip()) {
      closePanel();
      document.querySelectorAll(".akgun-call-action").forEach((node) => node.remove());
      return;
    }
    ensureMatrixDirectoryLoaded();
    document.querySelectorAll('[role="menu"][aria-label="More Options"]').forEach((menu) => ensureMenuCallAction(menu));
  }

  const menuObserver = new MutationObserver(() => {
    if (menuScanQueued) return;
    menuScanQueued = true;
    requestAnimationFrame(scanMenus);
    reopenPanelIfNeeded(60);
    if (panelShouldStayOpen && panelKeepAliveUntil && Date.now() <= panelKeepAliveUntil) {
      reopenPanelIfNeeded(240);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== SERVICE_ORIGIN || event.source !== frame.contentWindow) return;
    const data = event?.data;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "akgun:widget-ready") {
      widgetReady = true;
      lastThemeSignature = "";
      syncThemeToWidget();
      pushSipProfileToWidget();
      if (!sipProfileLoaded) {
        pushDebugLog("Launcher: widget hazir, SIP profili otomatik yukleniyor");
        void ensureSipProfileLoaded(true);
      }
      tryFlushPendingDialRequest();
      schedulePendingDialRetry();
      return;
    }
    if (data.type === "akgun:widget-registered") {
      widgetRegistered = !!data.registered;
      updateSidebarEntryState();
      tryFlushPendingDialRequest();
      schedulePendingDialRetry();
      return;
    }
    if (data.type === "akgun:call-state") {
      handleWidgetCallState(data);
      return;
    }
    if (data.type === "akgun:dial-received") {
      const ackNumber = data.number || "";
      const ackKey = `${ackNumber}|${data.autoCall ? "1" : "0"}`;
      if (!pendingDialRequest) return;
      if (ackKey !== pendingDialAckKey) return;
      clearPendingDialRetry();
      pendingDialRequest = null;
      pendingDialAckKey = "";
      pendingDialRetryCount = 0;
      return;
    }
    if (data.type === "akgun:retry-connect") {
      cachedMatrixSession = null;
      sipProfileLoaded = false;
      sipProfile = null;
      pushDebugLog("Launcher: manuel bağlantı isteği alındı");
      if (sipProfileLoading) {
        scheduleSipProfileRetry(250);
      } else {
        void ensureSipProfileLoaded(true);
      }
    }
  });

  frame.addEventListener("load", () => {
    window.setTimeout(() => bootstrapLoadedWidget("iframe load"), 0);
  });

  try {
    if (frame.contentDocument?.readyState === "complete") {
      window.setTimeout(() => bootstrapLoadedWidget("hazir belge"), 0);
    }
  } catch (_error) {
  }

  menuObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  themeObserver = new MutationObserver(() => {
    window.requestAnimationFrame(() => syncThemeToWidget());
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  document.querySelectorAll('link[data-mx-theme], style[data-mx-theme]').forEach((node) => {
    themeObserver.observe(node, {
      attributes: true,
      attributeFilter: ["disabled", "media", "href"],
    });
  });
  themeObserver.observe(document.head, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "media", "href"],
  });

  window.setInterval(() => {
    if (!widgetReady) return;
    syncThemeToWidget();
  }, 1200);

  window.setInterval(() => {
    cachedMatrixSession = null;
    if (!sipProfileLoaded && !sipProfileLoading) {
      void ensureSipProfileLoaded(true);
      return;
    }
    if (sipProfileLoaded && !sipProfileLoading && Date.now() - sipProfileLastLoadedAt >= 60000) {
      void ensureSipProfileLoaded(true);
    }
  }, 4000);

  window.setInterval(() => {
    const client = getElementMatrixClient();
    const clientUserId = String(client?.getUserId?.() || client?.credentials?.userId || "").trim();
    const storedUserId = String(getStoredValue("mx_user_id") || "").trim();
    const fingerprint = clientUserId || storedUserId;
    if (!fingerprint || fingerprint === lastMatrixSessionFingerprint) return;
    const previousFingerprint = lastMatrixSessionFingerprint;
    lastMatrixSessionFingerprint = fingerprint;
    if (!previousFingerprint && sipProfileLoaded && widgetRegistered) return;
    cachedMatrixSession = null;
    sipProfile = null;
    sipProfileLoaded = false;
    pushDebugLog(`Launcher: Matrix oturumu hazir (${fingerprint}); SIP baglantisi yenileniyor`);
    scheduleSipProfileRetry(100);
  }, 1500);

  window.addEventListener("hashchange", () => {
    reopenPanelIfNeeded(120);
    reopenPanelIfNeeded(420);
    if (panelShouldStayOpen && panelKeepAliveUntil && Date.now() <= panelKeepAliveUntil) {
      reopenPanelIfNeeded(900);
    }
  });

  window.addEventListener("online", () => {
    if (!sipProfileLoaded) void ensureSipProfileLoaded(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && widgetReady && !sipProfileLoaded) {
      void ensureSipProfileLoaded(true);
    }
  });

  restorePanelWidth();
  installMatrixAuthSniffer();
  syncThemeToWidget();
  window.setTimeout(() => {
    void ensureSipProfileLoaded();
  }, 2500);
  scanMenus();
})();
