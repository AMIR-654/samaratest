// ===== Merchant Profile (Redesigned) =====

let _profileMerchant = null;
let _profileInventory = null;
let _profilePrices = [];
let _profileTransactions = [];
let _profileUnsubscribers = [];

async function openMerchantProfile(merchantId) {
  stopProfileListeners();

  _profileMerchant = merchantsCache.find((m) => m.id === merchantId);
  if (!_profileMerchant) return;

  currentMerchantProfileId = merchantId;
  document.getElementById("accountsListContainer").style.display = "none";
  document.getElementById("accountsProfileContainer").style.display = "block";

  renderProfileHeader();
  await renderProfileData();
  startProfileListeners(merchantId);
}

function stopProfileListeners() {
  _profileUnsubscribers.forEach((u) => { try { u(); } catch {} });
  _profileUnsubscribers = [];
}

function startProfileListeners(merchantId) {
  // Listen to merchant doc for real-time balance/totals updates
  const merchantUnsub = db.collection("merchants").doc(merchantId)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      const data = { id: snap.id, ...snap.data() };
      _profileMerchant = data;
      // Update cache
      const idx = merchantsCache.findIndex((m) => m.id === merchantId);
      if (idx !== -1) merchantsCache[idx] = data;
      renderProfileHeader();
      renderSummaryCards();
      renderSettlementSection();
    }, (err) => console.warn("[Profile] Merchant listener error:", err));
  _profileUnsubscribers.push(merchantUnsub);

  // Listen to inventory doc for real-time stock changes
  const invUnsub = db.collection("merchant_inventory").doc(merchantId)
    .onSnapshot((snap) => {
      if (!snap.exists) {
        _profileInventory = null;
      } else {
        _profileInventory = { id: snap.id, ...snap.data() };
      }
      renderSummaryCards();
      renderAccountingTable();
    }, (err) => console.warn("[Profile] Inventory listener error:", err));
  _profileUnsubscribers.push(invUnsub);
}

async function renderProfileData() {
  renderProfileSkeleton();
  try {
    const m = _profileMerchant;
    await Promise.all([
      loadMerchantInventory(m.id).then((inv) => {
        _profileInventory = inv;
      }),
      loadInventoryPrices().then(() => {
        _profilePrices = inventoryCardPrices;
      }),
      loadTransactionHistory(m.id, 200).then((txns) => {
        _profileTransactions = txns;
      }),
    ]);
    renderSummaryCards();
    renderCardPricesRow();
    renderAccountingTable();
    renderSettlementSection();
    renderProfileActions();
  } catch (err) {
    document.getElementById("profileBody").innerHTML = `
      <div class="profile-error">
        <div class="profile-error-icon">⚠️</div>
        <div class="profile-error-text">خطأ في تحميل بيانات التاجر</div>
        <div class="profile-error-detail">${escapeHtml(err.message)}</div>
        <button class="btn btn-primary" onclick="openMerchantProfile('${_profileMerchant.id}')">إعادة المحاولة</button>
      </div>`;
  }
}

// ===== Skeleton Loading =====

function renderProfileSkeleton() {
  document.getElementById("profileSummaryCards").innerHTML = Array(6).fill(0).map(() => `
    <div class="profile-skeleton-card">
      <div class="skeleton-line" style="width:60%;height:12px;margin-bottom:8px;"></div>
      <div class="skeleton-line" style="width:80%;height:24px;"></div>
    </div>`).join("");
  document.getElementById("profileCardPrices").innerHTML = Array(5).fill(0).map(() => `
    <div class="profile-skeleton-price">
      <div class="skeleton-line" style="width:40px;height:32px;margin:0 auto 4px;"></div>
      <div class="skeleton-line" style="width:60px;height:12px;margin:0 auto;"></div>
    </div>`).join("");
  document.getElementById("profileAccountingBody").innerHTML = `<tr><td colspan="6"><div class="skeleton-line" style="width:100%;height:200px;border-radius:12px;"></div></td></tr>`;
  document.getElementById("profileSettlementBody").innerHTML = `<div class="skeleton-line" style="width:100%;height:120px;border-radius:12px;"></div>`;
}

// ===== Header =====

function renderProfileHeader() {
  const m = _profileMerchant;
  if (!m) return;

  document.getElementById("accProfileName").textContent = m.name || "";
  document.getElementById("accProfilePhone").textContent = m.phone || "-";

  const statusEl = document.getElementById("accProfileStatus");
  statusEl.className = `status-badge ${m.status === "active" ? "active" : "disabled"}`;
  statusEl.textContent = m.status === "active" ? "نشط" : "غير نشط";

  const fbStatusEl = document.getElementById("accProfileFirebaseStatus");
  if (fbStatusEl) {
    fbStatusEl.innerHTML = getFirebaseStatusBadge(m);
  }

  const lastActivity = m.updatedAt
    ? (m.updatedAt.toDate ? m.updatedAt.toDate() : new Date(m.updatedAt)).toLocaleString("ar-EG")
    : "-";
  const lastActEl = document.getElementById("accProfileLastActivity");
  if (lastActEl) {
    lastActEl.textContent = `آخر نشاط: ${lastActivity}`;
  }

  const editBtn = document.getElementById("profileEditBtn");
  if (editBtn) {
    editBtn.style.display = "inline-flex";
    editBtn.onclick = function () { openMerchantModal(m.id); };
  }
}

// ===== Summary Statistics Helper =====

function getAccountingStats() {
  const inv = _profileInventory;
  const priceMap = new Map(_profilePrices.map((p) => [p.category, p.merchantPrice]));
  const soldMap = new Map();
  
  _profileTransactions.forEach((tx) => {
    if (tx.type === "card_settlement" && tx.metadata?.entries) {
      tx.metadata.entries.forEach((e) => {
        soldMap.set(e.category, (soldMap.get(e.category) || 0) + (e.count || 0));
      });
    }
  });

  let grandRemaining = 0;
  let grandSold = 0;
  let grandTotalAdded = 0;
  let grandTotalValue = 0;

  const orderedCategories = ["5", "10", "20", "50", "100"];

  const rows = orderedCategories.map((cat) => {
    const invEntry = inv?.entries ? inv.entries.find((e) => e.category === cat) : null;
    const remaining = invEntry?.count ?? 0;
    const sold = soldMap.get(cat) || 0;
    const added = remaining + sold;
    const price = priceMap.get(cat) || 0;
    const rowResult = sold * price;

    grandRemaining += remaining;
    grandSold += sold;
    grandTotalAdded += added;
    grandTotalValue += rowResult;

    return {
      category: cat,
      added,
      sold,
      remaining,
      price,
      rowResult,
    };
  });

  return {
    rows,
    grandRemaining,
    grandSold,
    grandTotalAdded,
    grandTotalValue,
  };
}

// ===== Summary Cards =====

function renderSummaryCards() {
  const m = _profileMerchant;
  if (!m) return;

  const stats = getAccountingStats();
  const totalCollections = m.totalCollections ?? 0;
  const currentBalance = m.currentBalance ?? 0;
  const installations = m.installationCount ?? 0;

  document.getElementById("profileSummaryCards").innerHTML = `
    <div class="profile-metric" style="--metric-color:#6366F1; border-color:#6366F1; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">إجمالي الكروت</div>
      <div class="profile-metric-value">${stats.grandTotalAdded.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">كرت</div>
    </div>
    <div class="profile-metric" style="--metric-color:#10B981; border-color:#10B981; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">المباع</div>
      <div class="profile-metric-value">${stats.grandSold.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">كرت</div>
    </div>
    <div class="profile-metric" style="--metric-color:#F59E0B; border-color:#F59E0B; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">إجمالي المبيعات</div>
      <div class="profile-metric-value">${stats.grandTotalValue.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#10B981; border-color:#10B981; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">المستلم</div>
      <div class="profile-metric-value">${totalCollections.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#EF4444; border-color:#EF4444; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">المتبقي</div>
      <div class="profile-metric-value">${currentBalance.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#8B5CF6; border-color:#8B5CF6; display:flex; flex-direction:column; align-items:flex-end;">
      <div class="profile-metric-label">التركيبات</div>
      <div class="profile-metric-value">${installations.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">تركيب</div>
    </div>`;
}

// ===== Card Prices Row =====

function renderCardPricesRow() {
  const container = document.getElementById("profileCardPrices");
  if (!_profilePrices.length) {
    container.innerHTML = `<div class="profile-empty-prices">⚠️ لم يتم إضافة أسعار الكروت بعد</div>`;
    return;
  }
  const priceMap = new Map(_profilePrices.map((p) => [p.category, p.merchantPrice]));
  const ordered = ["100", "50", "20", "10", "5"];
  
  container.style.flexDirection = "row-reverse";
  container.style.alignItems = "center";
  container.innerHTML = ordered.map((cat) => {
    const price = priceMap.get(cat) || 0;
    return `
      <div class="profile-price-tile" style="background:#0A0E1A; border:1px solid var(--border); border-radius:8px; padding:8px 12px; min-width:70px;">
        <div class="profile-price-value" style="font-size:12px; color:#FFFFFF;">${price.toLocaleString("ar-SA")} ج.م</div>
        <div class="profile-price-label" style="font-size:14px; font-weight:bold; color:#3B82F6; margin-top:2px;">${cat}</div>
      </div>`;
  }).join("") + `<div style="margin-right:auto; font-weight:bold; color:var(--text-muted); font-size:13px;">سعر التاجر</div>`;
}

// ===== Accounting Table =====

function renderAccountingTable() {
  const stats = getAccountingStats();
  const inv = _profileInventory;
  if (!inv || !inv.entries || !inv.entries.length) {
    document.getElementById("profileAccountingBody").innerHTML = `
      <tr><td colspan="6" class="profile-empty-table">لا توجد عهدة حالياً</td></tr>`;
    document.getElementById("profileAccountingTotals").innerHTML = "";
    return;
  }

  // Row badges coloring mapping
  const badgeColors = {
    "5": "#EF4444",
    "10": "#8B5CF6",
    "20": "#3B82F6",
    "50": "#0EA5E9",
    "100": "#10B981"
  };

  const rows = stats.rows.map((row) => {
    const badgeColor = badgeColors[row.category] || "#233253";
    return `
      <tr>
        <td class="profile-td-category">
          <span style="background:${badgeColor}; color:white; padding:4px 10px; border-radius:6px; font-weight:bold; font-size:12px;">${row.category}</span>
        </td>
        <td class="profile-td-num">${row.added.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num">${row.sold.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num" style="color:#10B981;">${row.remaining.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num">${row.price.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num profile-td-total" style="color:#F59E0B; font-weight:bold;">${row.rowResult.toLocaleString("ar-SA")}</td>
      </tr>`;
  }).join("");

  document.getElementById("profileAccountingBody").innerHTML = rows;
  document.getElementById("profileAccountingTotals").innerHTML = `
    <tr class="profile-totals-row" style="border-top: 2px solid #EF4444;">
      <td style="font-weight:bold;">الإجمالي</td>
      <td class="profile-td-num" style="font-weight:bold;">${stats.grandTotalAdded.toLocaleString("ar-SA")}</td>
      <td class="profile-td-num" style="font-weight:bold;">${stats.grandSold.toLocaleString("ar-SA")}</td>
      <td class="profile-td-num" style="font-weight:bold; color:#10B981;">${stats.grandRemaining.toLocaleString("ar-SA")}</td>
      <td></td>
      <td class="profile-td-num profile-td-total" style="font-weight:bold; color:#F59E0B; font-size:15px;">${stats.grandTotalValue.toLocaleString("ar-SA")}</td>
    </tr>`;
}

// ===== Settlement Section =====

function renderSettlementSection() {
  const m = _profileMerchant;
  if (!m) return;

  const totalSettlements = m.totalSettlements ?? 0;
  const totalCollections = m.totalCollections ?? 0;
  const currentBalance = m.currentBalance ?? 0;
  const remaining = currentBalance;

  document.getElementById("profileSettlementBody").innerHTML = `
    <div class="settlement-grid">
      <div class="settlement-item">
        <div class="settlement-label">إجمالي الحساب</div>
        <div class="settlement-value" style="color:var(--danger);">${totalSettlements.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="settlement-item">
        <div class="settlement-label">المبلغ المستلم</div>
        <div class="settlement-value" style="color:var(--success);">${totalCollections.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="settlement-item">
        <div class="settlement-label">المتبقي</div>
        <div class="settlement-value" style="color:${remaining >= 0 ? "var(--warning)" : "var(--danger)"};">${remaining.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="settlement-item">
        <div class="settlement-label">الرصيد</div>
        <div class="settlement-value" style="font-size:24px;color:${remaining >= 0 ? "var(--success)" : "var(--danger)"};">${currentBalance.toLocaleString("ar-SA")} ج.م</div>
      </div>
    </div>
    <div class="settlement-input-row">
      <input type="number" id="settlementReceiveInput" class="settlement-input" placeholder="المبلغ المستلم" min="0" step="0.01" />
      <div class="settlement-input-hint" id="settlementReceiveHint"></div>
    </div>
    <button class="btn btn-primary settlement-save-btn" onclick="saveProfileSettlement()">
      💾 حفظ التسوية
    </button>`;

  document.getElementById("settlementReceiveInput").addEventListener("input", updateSettlementHint);
  updateSettlementHint();
}

function updateSettlementHint() {
  const receive = parseFloat(document.getElementById("settlementReceiveInput")?.value) || 0;
  const hint = document.getElementById("settlementReceiveHint");
  if (receive > 0) {
    const m = _profileMerchant;
    const newBalance = (m?.currentBalance ?? 0) - receive;
    hint.textContent = `المتبقي بعد التسوية: ${newBalance.toLocaleString("ar-SA")} ج.م`;
    hint.style.color = newBalance >= 0 ? "var(--success)" : "var(--danger)";
  } else {
    hint.textContent = "";
  }
}

async function saveProfileSettlement() {
  const m = _profileMerchant;
  if (!m) return;

  const receiveAmount = parseFloat(document.getElementById("settlementReceiveInput")?.value) || 0;
  if (receiveAmount <= 0) {
    alert("يرجى إدخال المبلغ المستلم");
    return;
  }
  if (receiveAmount > m.currentBalance) {
    if (!confirm(`المبلغ المستلم (${receiveAmount.toLocaleString("ar-SA")}) أكبر من الرصيد المتبقي (${(m.currentBalance || 0).toLocaleString("ar-SA")}). هل تتابع؟`)) return;
  }
  if (!confirm(`تأكيد تسوية بقيمة ${receiveAmount.toLocaleString("ar-SA")} ج.م؟`)) return;

  try {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const date = new Date().toISOString().split("T")[0];
    const time = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
    const newBalance = (m.currentBalance || 0) - receiveAmount;

    await db.runTransaction(async (transaction) => {
      const merchantRef = db.collection("merchants").doc(m.id);

      transaction.update(merchantRef, {
        totalCollections: firebase.firestore.FieldValue.increment(receiveAmount),
        currentBalance: firebase.firestore.FieldValue.increment(-receiveAmount),
        updatedAt: now,
      });

      const txnRef = db.collection("merchant_transactions").doc(m.id).collection("items").doc();
      transaction.set(txnRef, {
        type: "cash_collection",
        merchantId: m.id,
        amount: -receiveAmount,
        date,
        time,
        createdBy: "admin",
        notes: `تسوية نقدية: ${receiveAmount.toLocaleString("ar-SA")} ج.م`,
        metadata: { receiveAmount, balanceBefore: m.currentBalance, balanceAfter: newBalance },
        createdAt: now,
        updatedAt: now,
      });

      const auditRef = db.collection("merchant_audit_logs").doc();
      transaction.set(auditRef, {
        action: "create",
        collection: "merchant_settlement",
        docId: m.id,
        oldValue: { currentBalance: m.currentBalance, totalCollections: m.totalCollections || 0 },
        newValue: { currentBalance: newBalance, totalCollections: (m.totalCollections || 0) + receiveAmount },
        performedBy: "admin",
        reason: "تسوية نقدية",
        timestamp: now,
        date,
        time,
      });

      const notifRef = db.collection("merchant_notifications").doc();
      transaction.set(notifRef, {
        merchantId: m.id,
        type: "settlement",
        title: "تسوية نقدية",
        message: `تم استلام ${receiveAmount.toLocaleString("ar-SA")} ج.م`,
        read: false,
        createdAt: now,
      });
    });

    document.getElementById("settlementReceiveInput").value = "";
    await loadMerchants();
    markAccountsDirty();
    await refreshAccountsUI();
    showSuccess(`✅ تم حفظ التسوية بنجاح (${receiveAmount.toLocaleString("ar-SA")} ج.م)`);
  } catch (err) {
    alert("خطأ في حفظ التسوية: " + err.message);
  }
}

// ===== Action Buttons =====

function renderProfileActions() {
  const m = _profileMerchant;
  if (!m) return;

  document.getElementById("profileActions").innerHTML = `
    <button class="profile-action-btn profile-action-inv" onclick="openAddInventoryModal('${m.id}')" title="إضافة عهدة">
      <span class="profile-action-icon">➕</span>
      <span class="profile-action-label">إضافة عهدة</span>
    </button>
    <button class="profile-action-btn profile-action-settle" onclick="openSettlementModal('${m.id}')" title="حساب الكروت">
      <span class="profile-action-icon">🧮</span>
      <span class="profile-action-label">حساب الكروت</span>
    </button>
    <button class="profile-action-btn profile-action-save" onclick="document.getElementById('settlementReceiveInput')?.focus()" title="حفظ التسوية">
      <span class="profile-action-icon">💾</span>
      <span class="profile-action-label">حفظ التسوية</span>
    </button>
    <div class="profile-actions-dropdown">
      <button class="profile-action-btn profile-action-more" onclick="toggleActionsDropdown()" title="المزيد">
        <span class="profile-action-icon">⋮</span>
      </button>
      <div class="profile-dropdown-menu" id="profileDropdownMenu">
        <button onclick="openStatementModal('${m.id}')">📊 كشف الحساب</button>
        <button onclick="openMerchantModal('${m.id}')">✏️ تعديل</button>
        <button onclick="openInstallationModal('${m.id}')">🔧 إضافة تركيب</button>
        ${(!m.firebaseAuthUid || m.firebaseAuthStatus !== "active")
          ? `<button onclick="activateMerchantFirebaseAuth('${m.id}')">🔐 ${m.firebaseAuthUid ? "إعادة مزامنة Firebase" : "تفعيل Firebase"}</button>`
          : ""}
        <button onclick="toggleMerchantStatus('${m.id}')" style="color:var(--danger);">
          ${m.status === "active" ? "📦 أرشفة" : "🔄 إلغاء الأرشفة"}
        </button>
      </div>
    </div>`;
}

function toggleActionsDropdown() {
  const menu = document.getElementById("profileDropdownMenu");
  const isOpen = menu.classList.contains("open");
  menu.classList.toggle("open");
  if (!isOpen) {
    const close = (e) => {
      if (!e.target.closest(".profile-actions-dropdown")) {
        menu.classList.remove("open");
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
}

// ===== Back to List =====

function backToMerchantList() {
  stopProfileListeners();
  currentMerchantProfileId = null;
  _profileMerchant = null;
  _profileInventory = null;
  document.getElementById("accountsListContainer").style.display = "block";
  document.getElementById("accountsProfileContainer").style.display = "none";
  const editBtn = document.getElementById("profileEditBtn");
  if (editBtn) editBtn.style.display = "none";
}

// ===== Window exports =====

window.openMerchantProfile = openMerchantProfile;
window.backToMerchantList = backToMerchantList;
window.saveProfileSettlement = saveProfileSettlement;
window.toggleActionsDropdown = toggleActionsDropdown;
