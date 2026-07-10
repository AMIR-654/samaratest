// ===== Merchant Accounting Screen — New ERP Design =====

let _profileMerchant = null;
let _profileInventory = null;
let _profilePrices = [];
let _profileTransactions = [];
let _profileInstallations = [];
let _profileUnsubscribers = [];

// ===== Open / Close =====

async function openMerchantProfile(merchantId) {
  stopProfileListeners();

  _profileMerchant = merchantsCache.find((m) => m.id === merchantId);
  if (!_profileMerchant) return;

  currentMerchantProfileId = merchantId;
  $("merchantListView").style.display = "none";
  $("accountingScreenView").style.display = "block";

  renderAcctSkeleton();
  await renderAcctData();
  startProfileListeners(merchantId);
}

function backToMerchantList() {
  stopProfileListeners();
  currentMerchantProfileId = null;
  _profileMerchant = null;
  _profileInventory = null;
  $("merchantListView").style.display = "block";
  $("accountingScreenView").style.display = "none";
}

function stopProfileListeners() {
  _profileUnsubscribers.forEach((u) => { try { u(); } catch {} });
  _profileUnsubscribers = [];
}

function startProfileListeners(merchantId) {
  const merchantUnsub = db.collection("merchants").doc(merchantId)
    .onSnapshot((snap) => {
      if (!snap.exists) return;
      const data = { id: snap.id, ...snap.data() };
      _profileMerchant = data;
      const idx = merchantsCache.findIndex((m) => m.id === merchantId);
      if (idx !== -1) merchantsCache[idx] = data;
      renderAcctHeader();
      renderAcctSummary();
      renderAcctSettlement();
    }, (err) => console.warn("[Profile] Merchant listener error:", err));
  _profileUnsubscribers.push(merchantUnsub);

  const invUnsub = db.collection("merchant_inventory").doc(merchantId)
    .onSnapshot((snap) => {
      if (!snap.exists) {
        _profileInventory = null;
      } else {
        _profileInventory = { id: snap.id, ...snap.data() };
      }
      renderAcctSummary();
      renderAcctPriceStrip();
      renderAcctTable();
    }, (err) => console.warn("[Profile] Inventory listener error:", err));
  _profileUnsubscribers.push(invUnsub);
}

// ===== Skeleton =====

function renderAcctSkeleton() {
  $("acctSummary").innerHTML = Array(6).fill(0).map(() =>
    `<div class="acct-skeleton-card"><div class="acct-skeleton-line w40 h24"></div><div class="acct-skeleton-line w60"></div></div>`
  ).join("");
  $("acctPriceStrip").style.display = "none";
  $("acctTableBody").innerHTML = `<tr><td colspan="6"><div class="acct-skeleton-line w100 h40"></div></td></tr>`;
  $("acctSettlement").innerHTML = `<div class="acct-skeleton"><div class="acct-skeleton-line w60"></div><div class="acct-skeleton-line w80"></div><div class="acct-skeleton-line w40"></div></div>`;
  $("acctStatementTimeline").innerHTML = `<div class="acct-skeleton"><div class="acct-skeleton-line w80"></div><div class="acct-skeleton-line w60"></div><div class="acct-skeleton-line w40"></div></div>`;
  $("acctInstallationsList").innerHTML = `<div class="acct-skeleton"><div class="acct-skeleton-line w80"></div><div class="acct-skeleton-line w60"></div></div>`;
}

// ===== Load Data =====

async function renderAcctData() {
  try {
    const m = _profileMerchant;
    const [inv, txns, insts] = await Promise.all([
      loadMerchantInventory(m.id).then((inv) => { _profileInventory = inv; return inv; }),
      loadInventoryPrices().then(() => { _profilePrices = inventoryCardPrices; }),
      loadTransactionHistory(m.id, 200).then((txns) => { _profileTransactions = txns; return txns; }),
      loadMerchantInstallations(m.id).then((insts) => { _profileInstallations = insts; return insts; }),
    ]);
    renderAcctHeader();
    renderAcctSummary();
    renderAcctPriceStrip();
    renderAcctTable();
    renderAcctSettlement();
    renderAcctStatement();
    renderAcctInstallations();
  } catch (err) {
    $("acctBody").innerHTML = `
      <div class="merchant-error-state">
        <div class="merchant-error-state-icon">⚠️</div>
        <div class="merchant-error-state-text">خطأ في تحميل بيانات التاجر</div>
        <div class="merchant-error-state-hint">${escapeHtml(err.message)}</div>
        <button class="btn btn-primary" onclick="openMerchantProfile('${_profileMerchant.id}')">إعادة المحاولة</button>
      </div>`;
  }
}

// ===== Header =====

function renderAcctHeader() {
  const m = _profileMerchant;
  if (!m) return;

  const initial = (m.name || "?").charAt(0);
  const statusLabel = m.status === "active" ? "نشط" : "غير نشط";
  const statusClass = m.status === "active" ? "active" : "disabled";
  const fbOk = m.firebaseAuthUid && m.firebaseAuthStatus === "active";
  const fbHtml = fbOk
    ? '<span style="color:#22c55e;">🟢 Firebase مفعل</span>'
    : m.firebaseAuthUid
      ? '<span style="color:#eab308;">🟡 يحتاج مزامنة</span>'
      : '<span style="color:#ef4444;">🔴 غير مفعل</span>';
  const lastAct = m.updatedAt
    ? (m.updatedAt.toDate ? m.updatedAt.toDate() : new Date(m.updatedAt)).toLocaleString("ar-EG")
    : "-";

  $("acctAvatar").textContent = initial;
  $("acctName").textContent = m.name || "";
  $("acctStatusBadge").textContent = statusLabel;
  $("acctStatusBadge").className = "status-badge " + statusClass;
  $("acctCode").innerHTML = `<span style="font-family:monospace;direction:ltr;display:inline-block;">#${m.id}</span>`;
  $("acctPhone").innerHTML = `📞 ${escapeHtml(m.phone || "-")}`;
  $("acctFirebaseStatus").innerHTML = fbHtml;
  $("acctLastActivity").innerHTML = `🕐 ${lastAct}`;

  // Set date range defaults
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  if (!$("acctDateFrom").value) $("acctDateFrom").value = thirtyDaysAgo;
  if (!$("acctDateTo").value) $("acctDateTo").value = today;
}

// ===== Accounting Stats =====

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

    return { category: cat, added, sold, remaining, price, rowResult };
  });

  return { rows, grandRemaining, grandSold, grandTotalAdded, grandTotalValue };
}

// ===== Summary Dashboard =====

function renderAcctSummary() {
  const m = _profileMerchant;
  if (!m) return;

  const stats = getAccountingStats();
  const totalCollections = m.totalCollections ?? 0;
  const currentBalance = m.currentBalance ?? 0;
  const installations = m.installationCount ?? 0;

  $("acctSummary").innerHTML = `
    <div class="acct-summary-card">
      <div class="acct-summary-icon">📦</div>
      <div class="acct-summary-value info">${stats.grandTotalAdded.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">إجمالي الكروت</div>
    </div>
    <div class="acct-summary-card">
      <div class="acct-summary-icon">💳</div>
      <div class="acct-summary-value info">${stats.grandSold.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">الكروت المباعة</div>
    </div>
    <div class="acct-summary-card">
      <div class="acct-summary-icon">💰</div>
      <div class="acct-summary-value warning">${stats.grandTotalValue.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">إجمالي المبيعات</div>
    </div>
    <div class="acct-summary-card">
      <div class="acct-summary-icon">💵</div>
      <div class="acct-summary-value positive">${totalCollections.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">المستلم</div>
    </div>
    <div class="acct-summary-card">
      <div class="acct-summary-icon">📉</div>
      <div class="acct-summary-value negative">${currentBalance.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">المتبقي</div>
    </div>
    <div class="acct-summary-card">
      <div class="acct-summary-icon">🔧</div>
      <div class="acct-summary-value purple">${installations.toLocaleString("ar-SA")}</div>
      <div class="acct-summary-label">التركيبات</div>
    </div>`;
}

// ===== Price Strip =====

function renderAcctPriceStrip() {
  const container = $("acctPriceStrip");
  const scroll = $("acctPriceStripScroll");
  if (!_profilePrices.length) {
    container.style.display = "none";
    return;
  }
  const priceMap = new Map(_profilePrices.map((p) => [p.category, p.merchantPrice]));
  const invMap = new Map();
  if (_profileInventory?.entries) {
    _profileInventory.entries.forEach((e) => invMap.set(e.category, e.count));
  }
  const ordered = ["100", "50", "20", "10", "5"];

  container.style.display = "block";
  scroll.innerHTML = ordered.map((cat) => {
    const price = priceMap.get(cat) || 0;
    const inv = invMap.get(cat) || 0;
    return `
      <div class="acct-price-tile">
        <div class="acct-price-tile-category">${cat}</div>
        <div class="acct-price-tile-price">${price.toLocaleString("ar-SA")} ج.م</div>
        <div class="acct-price-tile-inventory">المتبقي: ${inv}</div>
      </div>`;
  }).join("");
}

// ===== Accounting Table =====

function renderAcctTable() {
  const stats = getAccountingStats();
  const inv = _profileInventory;

  if (!inv || !inv.entries || !inv.entries.length) {
    $("acctTableBody").innerHTML = `<tr><td colspan="6" class="acct-table-empty">لا توجد عهدة حالياً</td></tr>`;
    $("acctTableTotals").innerHTML = "";
    $("acctTableCount").textContent = "";
    return;
  }

  const badgeColors = { "5": "#EF4444", "10": "#8B5CF6", "20": "#3B82F6", "50": "#0EA5E9", "100": "#10B981" };

  const rows = stats.rows.map((row) => {
    const badgeColor = badgeColors[row.category] || "#233253";
    return `
      <tr>
        <td class="category-cell"><span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:6px;font-weight:700;font-size:12px;">${row.category}</span></td>
        <td class="num-cell">${row.added.toLocaleString("ar-SA")}</td>
        <td class="num-cell">${row.sold.toLocaleString("ar-SA")}</td>
        <td class="num-cell remaining-cell">${row.remaining.toLocaleString("ar-SA")}</td>
        <td class="num-cell">${row.price.toLocaleString("ar-SA")}</td>
        <td class="total-cell">${row.rowResult.toLocaleString("ar-SA")}</td>
      </tr>`;
  }).join("");

  $("acctTableBody").innerHTML = rows;
  $("acctTableTotals").innerHTML = `
    <tr>
      <td style="font-weight:700;">الإجمالي</td>
      <td class="num-cell" style="font-weight:700;">${stats.grandTotalAdded.toLocaleString("ar-SA")}</td>
      <td class="num-cell" style="font-weight:700;">${stats.grandSold.toLocaleString("ar-SA")}</td>
      <td class="num-cell remaining-cell" style="font-weight:700;">${stats.grandRemaining.toLocaleString("ar-SA")}</td>
      <td></td>
      <td class="total-cell" style="font-weight:700;font-size:15px;">${stats.grandTotalValue.toLocaleString("ar-SA")}</td>
    </tr>`;
  $("acctTableCount").textContent = `${stats.rows.length} فئات`;
}

// ===== Settlement Panel =====

function renderAcctSettlement() {
  const m = _profileMerchant;
  if (!m) return;

  const totalSales = (m.totalSettlements ?? 0);
  const totalCollections = (m.totalCollections ?? 0);
  const remainingAmount = totalSales - totalCollections;
  const currentBalance = m.currentBalance ?? 0;

  $("acctSettlement").innerHTML = `
    <div class="acct-settlement-grid">
      <div class="acct-settlement-item">
        <div class="acct-settlement-label">إجمالي المبيعات</div>
        <div class="acct-settlement-value" style="color:var(--danger);">${totalSales.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="acct-settlement-item">
        <div class="acct-settlement-label">إجمالي المستلم</div>
        <div class="acct-settlement-value" style="color:var(--success);">${totalCollections.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="acct-settlement-item">
        <div class="acct-settlement-label">المبلغ المتبقي</div>
        <div class="acct-settlement-value" style="color:${remainingAmount >= 0 ? "var(--warning)" : "var(--danger)"};">${remainingAmount.toLocaleString("ar-SA")} ج.م</div>
      </div>
      <div class="acct-settlement-item">
        <div class="acct-settlement-label">الرصيد الحالي</div>
        <div class="acct-settlement-value" style="font-size:24px;color:${currentBalance >= 0 ? "var(--success)" : "var(--danger)"};">${currentBalance.toLocaleString("ar-SA")} ج.م</div>
      </div>
    </div>
    <div class="acct-settlement-input-row">
      <input type="number" id="settlementReceiveInput" class="acct-settlement-input" placeholder="المبلغ المستلم" min="0" step="0.01" oninput="updateAcctSettlementHint()" />
    </div>
    <div class="acct-settlement-hint" id="acctSettlementHint"></div>
    <button class="acct-action-btn acct-action-collect" onclick="saveProfileSettlement()" style="width:100%;">
      💾 حفظ التسوية
    </button>`;
}

function updateAcctSettlementHint() {
  const receive = parseFloat($("settlementReceiveInput")?.value) || 0;
  const hint = $("acctSettlementHint");
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

  const receiveAmount = parseFloat($("settlementReceiveInput")?.value) || 0;
  if (receiveAmount <= 0) {
    showToast("يرجى إدخال المبلغ المستلم", "warning");
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

    $("settlementReceiveInput").value = "";
    await loadMerchants();
    markAccountsDirty();
    await refreshAccountsUI();
    showToast(`✅ تم حفظ التسوية بنجاح (${receiveAmount.toLocaleString("ar-SA")} ج.م)`, "success");
  } catch (err) {
    showToast("خطأ في حفظ التسوية: " + err.message, "error");
  }
}

// ===== Account Statement (Timeline) =====

function renderAcctStatement() {
  const container = $("acctStatementTimeline");
  let txns = _profileTransactions || [];

  // Filter by type
  const typeFilter = $("stmtFilterType")?.value;
  if (typeFilter) {
    txns = txns.filter((t) => t.type === typeFilter);
  }

  if (!txns.length) {
    container.innerHTML = `<div class="acct-statement-empty">لا توجد معاملات</div>`;
    return;
  }

  // Group by date
  const groups = {};
  txns.forEach((t) => {
    const d = t.date || "بدون تاريخ";
    if (!groups[d]) groups[d] = [];
    groups[d].push(t);
  });

  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const labels = {
    card_inventory_added: { label: "عهدة", icon: "📦", color: "#3B82F6" },
    card_settlement: { label: "حساب كروت", icon: "🧮", color: "#EF4444" },
    cash_collection: { label: "استلام نقدي", icon: "💵", color: "#10B981" },
    installation: { label: "تركيب", icon: "🔧", color: "#8B5CF6" },
    adjustment: { label: "تعديل", icon: "✏️", color: "#F59E0B" },
  };

  container.innerHTML = sortedDates.map((date) => `
    <div class="acct-statement-day">
      <div class="acct-statement-day-header">${date}</div>
      ${groups[date].map((t) => {
        const info = labels[t.type] || { label: t.type, icon: "📋", color: "#64748B" };
        return `
          <div class="acct-statement-item">
            <div class="acct-statement-item-icon" style="background:${info.color}20;color:${info.color};">${info.icon}</div>
            <div class="acct-statement-item-body">
              <div class="acct-statement-item-type">${info.label}</div>
              <div class="acct-statement-item-notes">${escapeHtml(t.notes || "")}</div>
            </div>
            <div class="acct-statement-item-amount" style="color:${(t.amount || 0) < 0 ? "var(--danger)" : "var(--success)"};">${(t.amount || 0).toLocaleString("ar-SA")} ج.م</div>
          </div>`;
      }).join("")}
    </div>
  `).join("");
}

function printAcctStatement() {
  const merchant = _profileMerchant;
  if (!merchant) return;

  const printWin = window.open("", "_blank", "width=800,height=600");
  printWin.document.write(`
    <html dir="rtl">
    <head><title>كشف حساب - ${merchant.name}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 40px; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
      th { background: #f5f5f5; }
      .total { font-weight: bold; font-size: 15px; margin-top: 16px; }
      @media print { body { padding: 20px; } }
    </style>
    </head>
    <body>
      <h1>كشف حساب التاجر: ${escapeHtml(merchant.name)}</h1>
      <div class="meta">الهاتف: ${escapeHtml(merchant.phone || "-")} | التاريخ: ${new Date().toLocaleDateString("ar-SA")}</div>
      ${document.getElementById("acctStatementTimeline")?.innerHTML || ""}
    </body>
    </html>
  `);
  printWin.document.close();
  setTimeout(() => printWin.print(), 500);
}

// ===== Installations =====

function renderAcctInstallations() {
  const container = $("acctInstallationsList");
  const insts = _profileInstallations || [];

  if (!insts.length) {
    container.innerHTML = `<div class="acct-statement-empty">لا توجد تركيبات</div>`;
    return;
  }

  container.innerHTML = insts.slice(0, 10).map((inst) => `
    <div class="acct-installation-item">
      <span style="font-size:16px;">🔧</span>
      <div class="acct-installation-customer">${escapeHtml(inst.customerName || "")}</div>
      <div class="acct-installation-meta">
        <span>${inst.region || ""}</span>
        <span>${inst.date || ""}</span>
      </div>
      <div class="acct-installation-price">${(inst.price || 0).toLocaleString("ar-SA")} ج.م</div>
    </div>
  `).join("");
}

// ===== Refresh (called from date range change) =====

async function refreshAccountingScreen() {
  if (!currentMerchantProfileId) return;
  const txns = await loadTransactionHistory(currentMerchantProfileId, 200);
  _profileTransactions = txns;
  renderAcctStatement();
}

// ===== More Menu =====

function toggleAcctMoreMenu() {
  const menu = $("acctMoreMenu");
  const isOpen = menu.classList.contains("open");
  menu.classList.toggle("open");
  if (!isOpen) {
    const close = (e) => {
      if (!e.target.closest(".acct-action-more-wrap")) {
        menu.classList.remove("open");
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
}

async function showAcctAuditLog() {
  if (!currentMerchantProfileId) return;
  const entries = await loadAuditLog(currentMerchantProfileId, 30);
  const container = $("acctStatementTimeline");
  // Temporarily show audit in the statement area
  if (!entries.length) {
    container.innerHTML = `<div class="acct-statement-empty">لا توجد عمليات مسجلة</div>`;
    return;
  }
  container.innerHTML = entries.map((e) => {
    const actionLabels = { create: "إنشاء", update: "تعديل", archive: "أرشفة", delete: "حذف", restore: "استعادة" };
    const label = actionLabels[e.action] || e.action;
    return `
      <div class="acct-statement-item">
        <div class="acct-statement-item-icon" style="background:var(--primary)20;color:var(--primary);">📋</div>
        <div class="acct-statement-item-body">
          <div class="acct-statement-item-type">${label}</div>
          <div class="acct-statement-item-notes">${e.collection || ""} ${e.reason ? "— " + e.reason : ""}</div>
        </div>
        <div class="acct-statement-item-amount" style="font-size:11px;color:var(--text-muted);font-weight:400;">${e.date || ""} ${e.time || ""}</div>
      </div>`;
  }).join("");
  showToast("تم عرض آخر 30 عملية", "info");
}

async function toggleMerchantArchive() {
  if (!currentMerchantProfileId) return;
  const m = _profileMerchant;
  if (!m) return;
  if (m.status === "archived") {
    showToast("التاجر مؤرشف بالفعل", "warning");
    return;
  }
  if (confirm(`هل تريد أرشفة التاجر "${m.name}"؟ سيتم إخفاؤه من القائمة الرئيسية مع الاحتفاظ بجميع بياناته.`)) {
    try {
      await db.collection("merchants").doc(m.id).update({
        status: "archived",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await recordAudit("archive", "merchants", m.id, { status: m.status }, { status: "archived" }, "أرشفة التاجر");
      await loadMerchants();
      showToast(`✅ تم أرشفة "${m.name}" بنجاح`, "success");
      backToMerchantList();
    } catch (err) {
      showToast("خطأ: " + err.message, "error");
    }
  }
}

// ===== Window exports =====

window.openMerchantProfile = openMerchantProfile;
window.backToMerchantList = backToMerchantList;
window.saveProfileSettlement = saveProfileSettlement;
window.toggleAcctMoreMenu = toggleAcctMoreMenu;
window.refreshAccountingScreen = refreshAccountingScreen;
window.showAcctAuditLog = showAcctAuditLog;
window.toggleMerchantArchive = toggleMerchantArchive;
window.updateAcctSettlementHint = updateAcctSettlementHint;
window.printAcctStatement = printAcctStatement;
window.renderAcctStatement = renderAcctStatement;
