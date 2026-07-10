// ===== Merchants Module =====

let merchantsCache = [];
let currentMerchantFilter = "";

async function loadMerchants() {
  try {
    const snap = await db.collection("merchants")
      .orderBy("createdAt", "desc")
      .get();
    merchantsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMerchants();
    updateMerchantStats();
  } catch (err) {
    console.error("[Merchants] Load failed:", err);
  }
}

function renderMerchants() {
  const body = $("merchantsBody");
  if (!body) return;

  const term = currentMerchantFilter.toLowerCase().trim();
  let filtered = merchantsCache;
  if (term) {
    filtered = filtered.filter((m) =>
      m.name?.toLowerCase().includes(term) ||
      m.phone?.includes(term) ||
      m.username?.toLowerCase().includes(term) ||
      m.address?.toLowerCase().includes(term)
    );
  }

  const showArchived = term.length > 0;
  if (!showArchived) {
    filtered = filtered.filter((m) => m.status !== "archived");
  }

  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:32px;">لا يوجد تجار بعد</td></tr>';
    return;
  }

  body.innerHTML = filtered.map((m) => {
    const statusLabel = m.status === "active" ? "نشط" : m.status === "inactive" ? "موقوف" : "مؤرشف";
    const statusClass = m.status === "active" ? "active" : m.status === "inactive" ? "disabled" : "unread";
    const cardCount = m.totalCards ?? 0;
    const installCount = m.installationCount ?? 0;
    const lastTx = m.lastTransactionDate ? new Date(m.lastTransactionDate).toLocaleDateString("ar-SA") : "—";

    return `
      <tr>
        <td><strong>${escapeHtml(m.name || "")}</strong></td>
        <td dir="ltr" style="text-align:right;">${escapeHtml(m.phone || "")}</td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td style="font-weight:600;">${(m.currentBalance ?? 0).toLocaleString("ar-SA")}</td>
        <td>${cardCount.toLocaleString("ar-SA")}</td>
        <td>${installCount.toLocaleString("ar-SA")}</td>
        <td style="font-size:12px;color:var(--text-muted);">${lastTx}</td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-primary" onclick="openMerchantProfile('${m.id}')">إدارة</button>
            <button class="btn btn-sm ${m.status === 'active' ? 'btn-outline' : 'btn-primary'}" onclick="toggleMerchantStatus('${m.id}')">${m.status === 'active' ? 'إيقاف' : 'تفعيل'}</button>
            <button class="btn btn-sm btn-outline" onclick="archiveMerchant('${m.id}')">أرشفة</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function updateMerchantStats() {
  const active = merchantsCache.filter((m) => m.status === "active");
  const totalCards = active.reduce((s, m) => s + (m.totalCards ?? 0), 0);
  const totalBalance = active.reduce((s, m) => s + (m.currentBalance ?? 0), 0);

  const el = (id) => document.getElementById(id);
  if (el("statsMerchants")) el("statsMerchants").textContent = active.length.toLocaleString("ar-SA");
  if (el("statsTotalCards")) el("statsTotalCards").textContent = totalCards.toLocaleString("ar-SA");
  if (el("statsTotalBalance")) el("statsTotalBalance").textContent = totalBalance.toLocaleString("ar-SA");
  if (el("statsTotalMerchants")) el("statsTotalMerchants").textContent = merchantsCache.length.toLocaleString("ar-SA");
}

function filterMerchants(value) {
  currentMerchantFilter = value;
  renderMerchants();
}

async function openMerchantModal(merchant) {
  $("merchantModalTitle").textContent = merchant ? "تعديل تاجر" : "إضافة تاجر";
  $("merchantId").value = merchant ? merchant.id : "";
  $("merchantName").value = merchant ? merchant.name : "";
  $("merchantPhone").value = merchant ? merchant.phone : "";
  $("merchantUsername").value = merchant ? merchant.username : "";
  $("merchantPassword").value = "";
  $("merchantAddress").value = merchant ? merchant.address || "" : "";
  $("merchantNotes").value = merchant ? merchant.notes || "" : "";
  $("merchantSupportsInstallations").checked = merchant ? merchant.supportsInstallations ?? false : false;
  $("merchantStatus").value = merchant ? merchant.status || "active" : "active";
  $("merchantPassword").required = !merchant;
  $("merchantModal").classList.add("open");
}

async function saveMerchant(e) {
  e.preventDefault();
  const id = $("merchantId").value.trim();

  // ---- Data Validation ----
  const name = $("merchantName").value.trim();
  if (!name) {
    alert("اسم التاجر مطلوب");
    return;
  }

  const phone = $("merchantPhone").value.trim();
  if (!phone) {
    alert("رقم الهاتف مطلوب");
    return;
  }
  if (!/^01[0-9]{9}$/.test(phone)) {
    alert("رقم الهاتف غير صحيح. يجب أن يكون 11 رقماً يبدأ بـ 01 (مثال: 01234567890)");
    return;
  }

  const username = $("merchantUsername").value.trim();
  if (!username) {
    alert("اسم المستخدم مطلوب");
    return;
  }
  if (username.length < 3) {
    alert("اسم المستخدم يجب أن يكون 3 أحرف على الأقل");
    return;
  }

  const password = $("merchantPassword").value.trim();
  if (!id && !password) {
    alert("كلمة المرور مطلوبة للتاجر الجديد");
    return;
  }

  const data = {
    name,
    phone,
    username,
    address: $("merchantAddress").value.trim(),
    notes: $("merchantNotes").value.trim(),
    supportsInstallations: $("merchantSupportsInstallations").checked,
    status: $("merchantStatus").value,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    // ---- Username uniqueness check ----
    const existingSnap = await db.collection("merchants")
      .where("username", "==", username)
      .get();
    const isDuplicate = existingSnap.docs.some((d) => d.id !== id);
    if (isDuplicate) {
      alert("اسم المستخدم موجود بالفعل، يرجى اختيار اسم آخر");
      return;
    }

    if (id) {
      // ---- Update with full audit (atomic) ----
      if (password) data.password = password;
      data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      const date = new Date().toISOString().split("T")[0];
      const time = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

      await db.runTransaction(async (transaction) => {
        const merchantRef = db.collection("merchants").doc(id);
        const oldDoc = await transaction.get(merchantRef);
        if (!oldDoc.exists) throw new Error("التاجر غير موجود");

        const oldData = oldDoc.data();
        transaction.update(merchantRef, data);

        const auditRef = db.collection("merchant_audit_logs").doc();
        transaction.set(auditRef, {
          action: "update",
          collection: "merchants",
          docId: id,
          oldValue: {
            name: oldData.name,
            phone: oldData.phone,
            username: oldData.username,
            status: oldData.status,
            address: oldData.address,
            notes: oldData.notes,
            supportsInstallations: oldData.supportsInstallations,
          },
          newValue: {
            name: data.name,
            phone: data.phone,
            username: data.username,
            status: data.status,
            address: data.address,
            notes: data.notes,
            supportsInstallations: data.supportsInstallations,
          },
          performedBy: "admin",
          reason: "تحديث بيانات التاجر",
          timestamp: firebase.firestore.FieldValue.serverTimestamp(),
          date,
          time,
        });
      });
    } else {
      // ---- Create ----
      data.password = password;
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.totalCards = 0;
      data.totalCardValue = 0;
      data.totalSettlements = 0;
      data.totalCollections = 0;
      data.currentBalance = 0;
      data.installationCount = 0;
      data.createdBy = "admin";

      const ref = await db.collection("merchants").add(data);
      await recordAudit("create", "merchants", ref.id, null, data, "إضافة تاجر جديد");
    }
    $("merchantModal").classList.remove("open");
    await loadMerchants();
    if (typeof markAccountsDirty === "function") markAccountsDirty();
    if (typeof refreshAccountsUI === "function") await refreshAccountsUI();
    if (id && typeof refreshMerchantProfile === "function") await refreshMerchantProfile();
  } catch (err) {
    alert("خطأ: " + err.message);
  }
}

async function toggleMerchantStatus(id) {
  const m = merchantsCache.find((x) => x.id === id);
  if (!m) return;
  const newStatus = m.status === "active" ? "inactive" : "active";
  try {
    await db.collection("merchants").doc(id).update({
      status: newStatus,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await recordAudit("update", "merchants", id, { status: m.status }, { status: newStatus },
      newStatus === "active" ? "تفعيل التاجر" : "إيقاف التاجر");
    await loadMerchants();
  } catch (err) {
    alert("خطأ: " + err.message);
  }
}

async function archiveMerchant(id) {
  const m = merchantsCache.find((x) => x.id === id);
  if (!m) return;
  if (!confirm(`هل تريد أرشفة التاجر "${m.name}"؟ سيتم إخفاؤه من القائمة الرئيسية مع الاحتفاظ بجميع بياناته.`)) return;
  try {
    await db.collection("merchants").doc(id).update({
      status: "archived",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await recordAudit("archive", "merchants", id, { status: m.status }, { status: "archived" }, "أرشفة التاجر");
    await loadMerchants();
  } catch (err) {
    alert("خطأ: " + err.message);
  }
}

window.loadMerchants = loadMerchants;
window.saveMerchant = saveMerchant;
window.openMerchantModal = openMerchantModal;
window.toggleMerchantStatus = toggleMerchantStatus;
window.archiveMerchant = archiveMerchant;
window.filterMerchants = filterMerchants;
