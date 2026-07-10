// ===== Accounts Module (Orchestrator) =====

let currentMerchantProfileId = null;
let currentProfileTab = "transactions";
let _accountsData = null;
let _accountsDataDirty = true;
let _pricesLoaded = false;

function markAccountsDirty() {
  _accountsDataDirty = true;
}

async function _ensureAccountsData() {
  if (!_pricesLoaded) {
    await loadInventoryPrices();
    _pricesLoaded = true;
  }
  if (_accountsDataDirty || !_accountsData) {
    const snap = await db.collection("merchants")
      .where("status", "!=", "archived")
      .orderBy("createdAt", "desc")
      .get();
    _accountsData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    merchantsCache = _accountsData;
    _accountsDataDirty = false;
  }
  return _accountsData;
}

function initAccounts() {
  return _ensureAccountsData();
}

// ===================== Dashboard =====================

async function renderAccountsDashboard() {
  const container = $("accountsDashboard");
  if (!container) return;

  container.innerHTML = '<div class="loading">جاري تحميل البيانات...</div>';

  try {
    const merchants = await _ensureAccountsData();

    let totalCards = 0;
    let totalCardValue = 0;
    let totalSettlements = 0;
    let totalInstallations = 0;
    let activeCount = 0;
    let inactiveCount = 0;

    merchants.forEach((m) => {
      totalCards += m.totalCards || 0;
      totalCardValue += m.totalCardValue || 0;
      totalSettlements += m.totalSettlements || 0;
      totalInstallations += m.installationCount || 0;
      if (m.status === "active") activeCount++;
      else inactiveCount++;
    });

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px;">
        <div class="metric-card" style="background:linear-gradient(135deg,#667eea,#764ba2);color:white;padding:20px;border-radius:12px;">
          <div style="font-size:13px;opacity:0.9;">إجمالي التجار</div>
          <div style="font-size:32px;font-weight:700;">${merchants.length}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.8;">
            <span style="color:#4ade80;">● ${activeCount} نشط</span> |
            <span style="color:#fbbf24;">● ${inactiveCount} غير نشط</span>
          </div>
        </div>
        <div class="metric-card" style="background:linear-gradient(135deg,#f093fb,#f5576c);color:white;padding:20px;border-radius:12px;">
          <div style="font-size:13px;opacity:0.9;">إجمالي العهدة</div>
          <div style="font-size:32px;font-weight:700;">${totalCardValue.toLocaleString("ar-SA")}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.8;">${totalCards.toLocaleString("ar-SA")} كرت</div>
        </div>
        <div class="metric-card" style="background:linear-gradient(135deg,#4facfe,#00f2fe);color:white;padding:20px;border-radius:12px;">
          <div style="font-size:13px;opacity:0.9;">إجمالي الحسابات</div>
          <div style="font-size:32px;font-weight:700;">${totalSettlements.toLocaleString("ar-SA")}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.8;">ج.م</div>
        </div>
        <div class="metric-card" style="background:linear-gradient(135deg,#43e97b,#38f9d7);color:white;padding:20px;border-radius:12px;">
          <div style="font-size:13px;opacity:0.9;">التركيبات</div>
          <div style="font-size:32px;font-weight:700;">${totalInstallations.toLocaleString("ar-SA")}</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.8;">تركيب</div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);">خطأ: ${escapeHtml(err.message)}</p>`;
  }
}

// ===================== Merchant List =====================

async function renderAccountsMerchantList() {
  const container = $("accountsMerchantList");
  if (!container) return;

  container.innerHTML = '<div class="loading">جاري تحميل التجار...</div>';

  try {
    const merchants = await _ensureAccountsData();

    if (!merchants.length) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:32px;">لا يوجد تجار بعد</p>';
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <input type="text" id="accMerchantSearch" class="search-input" placeholder="🔍 بحث بالاسم أو الهاتف..."
          oninput="filterAccountsMerchantList()" style="width:100%;max-width:400px;" />
      </div>
      <div id="accMerchantGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;">
        ${renderMerchantCards(merchants)}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger);">خطأ: ${escapeHtml(err.message)}</p>`;
  }
}

function getFirebaseStatusBadge(merchant) {
  if (!merchant.firebaseAuthUid) {
    return '<span style="color:#ef4444;font-size:12px;">🔴 غير مفعل</span>';
  }
  if (merchant.firebaseAuthStatus === "active") {
    return '<span style="color:#22c55e;font-size:12px;" title="حساب Firebase Auth نشط">🟢 مفعل</span>';
  }
  return '<span style="color:#eab308;font-size:12px;" title="حساب Firebase Auth غير متوافق. يرجى إعادة المزامنة">🟡 يحتاج مزامنة</span>';
}

function renderMerchantCards(merchants) {
  return merchants.map((m) => `
    <div class="card" style="padding:16px;cursor:pointer;" onclick="openMerchantProfile('${m.id}')">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;">${escapeHtml(m.name || "")}</div>
          <div style="font-size:12px;color:var(--text-muted);" dir="ltr">${escapeHtml(m.phone || "")}</div>
        </div>
        <div style="text-align:left;">
          <div><span class="status-badge ${m.status === "active" ? "active" : "disabled"}">${m.status === "active" ? "نشط" : "غير نشط"}</span></div>
          <div style="margin-top:4px;">${getFirebaseStatusBadge(m)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;font-size:12px;">
        <div>
          <span style="color:var(--text-muted);">العهدة:</span>
          <span style="font-weight:600;">${(m.totalCardValue || 0).toLocaleString("ar-SA")} ج.م</span>
        </div>
        <div>
          <span style="color:var(--text-muted);">الحسابات:</span>
          <span style="font-weight:600;">${(m.totalSettlements || 0).toLocaleString("ar-SA")} ج.م</span>
        </div>
        <div>
          <span style="color:var(--text-muted);">الكروت:</span>
          <span style="font-weight:600;">${(m.totalCards || 0).toLocaleString("ar-SA")}</span>
        </div>
        <div>
          <span style="color:var(--text-muted);">التركيبات:</span>
          <span style="font-weight:600;">${(m.installationCount || 0)}</span>
        </div>
      </div>
    </div>
  `).join("");
}

function filterAccountsMerchantList() {
  const q = ($("accMerchantSearch")?.value || "").trim().toLowerCase();
  const grid = $("accMerchantGrid");
  if (!grid) return;

  const data = _accountsData || [];
  const filtered = data.filter((m) =>
    (m.name || "").toLowerCase().includes(q) ||
    (m.phone || "").includes(q)
  );

  grid.innerHTML = filtered.length
    ? renderMerchantCards(filtered)
    : '<p style="text-align:center;color:var(--text-muted);padding:24px;">لا توجد نتائج</p>';
}

// ===================== Merchant Profile =====================

async function refreshMerchantProfile() {
  try {
    const doc = await db.collection("merchants").doc(currentMerchantProfileId).get();
    if (doc.exists) {
      const idx = merchantsCache.findIndex((m) => m.id === currentMerchantProfileId);
      if (idx !== -1) merchantsCache[idx] = { id: doc.id, ...doc.data() };
      if (typeof openMerchantProfile === "function") {
        await openMerchantProfile(currentMerchantProfileId);
      }
    }
  } catch (err) {
    console.warn("[Accounts] Refresh profile failed:", err.message);
  }
}

// ===================== Refresh UI (in-place) =====================

async function refreshAccountsUI() {
  if ($("accountsListContainer")?.style.display !== "none") {
    await renderAccountsDashboard();
    await renderAccountsMerchantList();
  }
}

// ===================== Tab Activation =====================

async function onAccountsTabActivated(subTab) {
  await initAccounts();

  if (subTab === "profile" && currentMerchantProfileId) {
    $("accountsListContainer").style.display = "none";
    $("accountsProfileContainer").style.display = "block";
    if (typeof openMerchantProfile === "function") {
      await openMerchantProfile(currentMerchantProfileId);
    }
  } else {
    $("accountsListContainer").style.display = "block";
    $("accountsProfileContainer").style.display = "none";
    await renderAccountsDashboard();
    await renderAccountsMerchantList();
  }
}

// ===================== Firebase Auth Activation =====================

async function activateMerchantFirebaseAuth(merchantId) {
  const merchant = merchantsCache.find((m) => m.id === merchantId);
  if (!merchant) return;

  const needsSync = merchant.firebaseAuthUid && merchant.firebaseAuthStatus !== "active";
  const msg = needsSync
    ? `حساب Firebase Auth للتاجر "${merchant.name}" يحتاج إعادة مزامنة. هل تتابع؟`
    : `سيتم إنشاء حساب Firebase Auth للتاجر "${merchant.name}". هل تتابع؟`;

  if (!confirm(msg)) return;

  const btns = $("accProfileActions")?.querySelectorAll("button");
  const activateBtn = btns ? btns[btns.length - (needsSync ? 1 : 1)] : null;
  if (activateBtn) {
    activateBtn.disabled = true;
    activateBtn.textContent = "⏳ جاري التفعيل...";
  }

  try {
    console.log(`[activateFirebaseAuth] Starting for merchant ${merchantId}`);
    const provisionFn = firebase.functions().httpsCallable("provisionMerchantAuth");
    const result = await provisionFn({
      merchantId,
      phone: merchant.phone || "",
      email: merchant.email || null,
    });

    const data = result.data;

    if (data.success) {
      console.log(`[activateFirebaseAuth] Success for merchant ${merchantId}: uid=${data.uid}`);
      merchant.firebaseAuthUid = data.uid;
      merchant.firebaseAuthStatus = "active";
      _accountsDataDirty = true;
      await refreshMerchantProfile();
      await renderAccountsMerchantList();
      alert(`✅ تم ${needsSync ? "إعادة المزامنة" : "تفعيل Firebase Auth"} بنجاح للتاجر "${merchant.name}"`);
    } else {
      console.error(`[activateFirebaseAuth] Failed for merchant ${merchantId}:`, data.error, data.message);
      alert(`❌ فشل التفعيل: ${data.message || data.error}`);
      if (activateBtn) {
        activateBtn.disabled = false;
        activateBtn.textContent = "🔄 إعادة المحاولة";
      }
    }
  } catch (err) {
    console.error("[activateFirebaseAuth] Error:", err);
    alert("❌ خطأ في الاتصال: " + err.message);
    if (activateBtn) {
      activateBtn.disabled = false;
      activateBtn.textContent = "🔄 إعادة المحاولة";
    }
  }
}

async function checkMerchantAuthStatus(merchantId) {
  try {
    const checkFn = firebase.functions().httpsCallable("checkMerchantAuthStatus");
    const result = await checkFn({ merchantId });
    return result.data;
  } catch (err) {
    console.error("[checkMerchantAuthStatus] Error:", err);
    return { success: false, status: "unknown" };
  }
}

window.refreshAccountsUI = refreshAccountsUI;
window.markAccountsDirty = markAccountsDirty;
window.initAccounts = initAccounts;
window.onAccountsTabActivated = onAccountsTabActivated;
window.renderAccountsDashboard = renderAccountsDashboard;
window.renderAccountsMerchantList = renderAccountsMerchantList;
window.filterAccountsMerchantList = filterAccountsMerchantList;
window.refreshMerchantProfile = refreshMerchantProfile;
window.activateMerchantFirebaseAuth = activateMerchantFirebaseAuth;
window.checkMerchantAuthStatus = checkMerchantAuthStatus;
