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
  document.getElementById("profileBody").innerHTML = `
    <div class="profile-summary-row">
      ${Array(6).fill(0).map(() => `
        <div class="profile-skeleton-card">
          <div class="skeleton-line" style="width:60%;height:12px;margin-bottom:8px;"></div>
          <div class="skeleton-line" style="width:80%;height:24px;"></div>
        </div>`).join("")}
    </div>
    <div class="profile-prices-row">
      ${Array(5).fill(0).map(() => `
        <div class="profile-skeleton-price">
          <div class="skeleton-line" style="width:40px;height:32px;margin:0 auto 4px;"></div>
          <div class="skeleton-line" style="width:60px;height:12px;margin:0 auto;"></div>
        </div>`).join("")}
    </div>
    <div class="skeleton-line" style="width:100%;height:200px;margin-top:16px;border-radius:12px;"></div>
    <div class="skeleton-line" style="width:100%;height:120px;margin-top:16px;border-radius:12px;"></div>`;
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

// ===== Summary Cards =====

function renderSummaryCards() {
  const m = _profileMerchant;
  const inv = _profileInventory;
  if (!m) return;

  const totalCards = inv?.totalCards ?? 0;
  const totalCardValue = inv?.totalValue ?? 0;
  const totalSettlements = m.totalSettlements ?? 0;
  const totalCollections = m.totalCollections ?? 0;
  const currentBalance = m.currentBalance ?? 0;
  const installations = m.installationCount ?? 0;

  document.getElementById("profileSummaryCards").innerHTML = `
    <div class="profile-metric" style="--metric-color:#0EA5E9;">
      <div class="profile-metric-label">إجمالي الكروت</div>
      <div class="profile-metric-value">${totalCards.toLocaleString("ar-SA")}</div>
    </div>
    <div class="profile-metric" style="--metric-color:#22C55E;">
      <div class="profile-metric-label">إجمالي المبيعات</div>
      <div class="profile-metric-value">${totalCardValue.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#F59E0B;">
      <div class="profile-metric-label">إجمالي الحساب</div>
      <div class="profile-metric-value">${totalSettlements.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#8B5CF6;">
      <div class="profile-metric-label">إجمالي المستلم</div>
      <div class="profile-metric-value">${totalCollections.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:${currentBalance >= 0 ? "#0EA5E9" : "#EF4444"};">
      <div class="profile-metric-label">المتبقي</div>
      <div class="profile-metric-value">${currentBalance.toLocaleString("ar-SA")}</div>
      <div class="profile-metric-unit">ج.م</div>
    </div>
    <div class="profile-metric" style="--metric-color:#EC4899;">
      <div class="profile-metric-label">التركيبات</div>
      <div class="profile-metric-value">${installations.toLocaleString("ar-SA")}</div>
    </div>`;
}

// ===== Card Prices Row =====

function renderCardPricesRow() {
  const container = document.getElementById("profileCardPrices");
  if (!_profilePrices.length) {
    container.innerHTML = `<div class="profile-empty-prices">⚠️ لم يتم إضافة أسعار الكروت بعد</div>`;
    return;
  }
  container.innerHTML = _profilePrices.map((p) => `
    <div class="profile-price-tile">
      <div class="profile-price-value">${p.merchantPrice}</div>
      <div class="profile-price-label">${p.category}</div>
    </div>`).join("");
}

// ===== Accounting Table =====

function renderAccountingTable() {
  const inv = _profileInventory;
  if (!inv || !inv.entries || !inv.entries.length) {
    document.getElementById("profileAccountingBody").innerHTML = `
      <tr><td colspan="6" class="profile-empty-table">لا توجد عهدة حالياً</td></tr>`;
    document.getElementById("profileAccountingTotals").innerHTML = "";
    return;
  }

  const priceMap = new Map(_profilePrices.map((p) => [p.category, p.merchantPrice]));
  const entries = inv.entries;

  // Calculate sold per category from settlement transactions
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
  let grandTotal = 0;

  const rows = entries.map((e) => {
    const remaining = e.count || 0;
    const sold = soldMap.get(e.category) || 0;
    const totalAdded = remaining + sold;
    const price = priceMap.get(e.category) || 0;
    const total = sold * price;

    grandRemaining += remaining;
    grandSold += sold;
    grandTotalAdded += totalAdded;
    grandTotal += total;

    return `
      <tr>
        <td class="profile-td-category">${e.category}</td>
        <td class="profile-td-num">${totalAdded.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num">${sold.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num">${remaining.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num">${price.toLocaleString("ar-SA")}</td>
        <td class="profile-td-num profile-td-total">${total.toLocaleString("ar-SA")}</td>
      </tr>`;
  }).join("");

  document.getElementById("profileAccountingBody").innerHTML = rows;
  document.getElementById("profileAccountingTotals").innerHTML = `
    <tr class="profile-totals-row">
      <td>الإجمالي</td>
      <td class="profile-td-num">${grandTotalAdded.toLocaleString("ar-SA")}</td>
      <td class="profile-td-num">${grandSold.toLocaleString("ar-SA")}</td>
      <td class="profile-td-num">${grandRemaining.toLocaleString("ar-SA")}</td>
      <td></td>
      <td class="profile-td-num profile-td-total">${grandTotal.toLocaleString("ar-SA")}</td>
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
