// ===== Inventory (العهدة) Module =====

let inventoryCardPrices = [];

async function loadInventoryPrices() {
  try {
    const snap = await db.collection("merchant_card_prices")
      .orderBy("sortOrder", "asc")
      .get();
    inventoryCardPrices = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("[Inventory] Failed to load prices:", err.message);
  }
}

function getPriceSnapshot() {
  return inventoryCardPrices.map((p) => ({
    category: p.category,
    merchantPrice: p.merchantPrice,
  }));
}

function openAddInventoryModal(merchantId) {
  const merchant = merchantsCache.find((m) => m.id === merchantId);
  $("invMerchantId").value = merchantId;
  $("invModalTitle").textContent = `إضافة عهدة — ${merchant ? merchant.name : ""}`;

  const container = $("invPriceEntries");
  if (!container) return;

  if (!inventoryCardPrices.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:16px;">يرجى إضافة أسعار الكروت أولاً في إعدادات أسعار الكروت</p>';
  } else {
    container.innerHTML = inventoryCardPrices.map((p) => `
      <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">
        <span style="flex:1;font-weight:600;">فئة ${p.category}</span>
        <span style="font-size:12px;color:var(--text-muted);">السعر: ${p.merchantPrice} ج.م</span>
        <input type="number" min="0" value="0" class="inv-count" data-category="${p.category}" data-price="${p.merchantPrice}"
          style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;text-align:center;background:var(--surface);color:var(--text);" />
      </div>
    `).join("");
  }

  $("invTotalCards").textContent = "0";
  $("invTotalValue").textContent = "0 ج.م";
  $("invModal").classList.add("open");

  container.querySelectorAll(".inv-count").forEach((input) => {
    input.addEventListener("input", updateInventorySummary);
  });
}

function updateInventorySummary() {
  let totalCards = 0;
  let totalValue = 0;
  document.querySelectorAll(".inv-count").forEach((input) => {
    const count = parseInt(input.value) || 0;
    const price = parseFloat(input.dataset.price) || 0;
    totalCards += count;
    totalValue += count * price;
  });
  $("invTotalCards").textContent = totalCards.toLocaleString("ar-SA");
  $("invTotalValue").textContent = totalValue.toLocaleString("ar-SA") + " ج.م";
}

async function saveInventory(e) {
  e.preventDefault();
  const merchantId = $("invMerchantId").value;
  if (!merchantId) return;

  const entries = [];
  let formValid = true;
  document.querySelectorAll(".inv-count").forEach((input) => {
    const count = parseInt(input.value) || 0;
    if (count > 0) {
      const price = parseFloat(input.dataset.price) || 0;
      if (count < 0) { showToast("عدد الكروت لا يمكن أن يكون سالباً", "warning"); formValid = false; return; }
      if (!input.dataset.category) { showToast("فئة الكرت غير محددة", "warning"); formValid = false; return; }
      entries.push({ category: input.dataset.category, count, price });
    }
  });
  if (!formValid) return;

  if (!entries.length) { showToast("يرجى إدخال عدد الكروت المطلوب إضافتها", "warning"); return; }

  const totalCards = entries.reduce((s, e) => s + e.count, 0);
  const totalValue = entries.reduce((s, e) => s + e.count * e.price, 0);
  if (totalCards <= 0) { showToast("يجب إضافة كرت واحد على الأقل", "warning"); return; }

  try {
    const now = firebase.firestore.FieldValue.serverTimestamp();
    const date = new Date().toISOString().split("T")[0];
    const time = new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });

    await db.runTransaction(async (transaction) => {
      const invRef = db.collection("merchant_inventory").doc(merchantId);
      const merchantRef = db.collection("merchants").doc(merchantId);

      const invDoc = await transaction.get(invRef);
      const invData = invDoc.exists ? invDoc.data() : { entries: [] };

      const mergedMap = {};
      (invData.entries || []).forEach((e) => {
        mergedMap[e.category] = (mergedMap[e.category] || 0) + (e.count || 0);
      });
      entries.forEach((e) => {
        mergedMap[e.category] = (mergedMap[e.category] || 0) + e.count;
      });

      const newEntries = Object.entries(mergedMap).map(([category, count]) => ({ category, count }));
      const newTotalCards = newEntries.reduce((s, e) => s + e.count, 0);
      const newTotalValue = newEntries.reduce((s, e) => {
        const p = inventoryCardPrices.find((p) => p.category === e.category)?.merchantPrice || 0;
        return s + e.count * p;
      }, 0);

      if (invDoc.exists) {
        transaction.update(invRef, { entries: newEntries, totalCards: newTotalCards, totalValue: newTotalValue, updatedAt: now });
      } else {
        transaction.set(invRef, { merchantId, entries: newEntries, totalCards: newTotalCards, totalValue: newTotalValue, createdAt: now, updatedAt: now });
      }

      transaction.update(merchantRef, {
        totalCards: newTotalCards, totalCardValue: newTotalValue,
        currentBalance: firebase.firestore.FieldValue.increment(totalValue),
        updatedAt: now,
      });

      const txnRef = db.collection("merchant_transactions").doc(merchantId).collection("items").doc();
      transaction.set(txnRef, {
        type: "card_inventory_added", merchantId, amount: 0, date, time, createdBy: "admin",
        notes: `إضافة عهدة: ${entries.map((e) => `${e.count} كارت فئة ${e.category}`).join("، ")}`,
        priceSnapshot: getPriceSnapshot(), metadata: { entries, totalCards, totalValue }, createdAt: now, updatedAt: now,
      });

      const auditRef = db.collection("merchant_audit_logs").doc();
      transaction.set(auditRef, {
        action: "create", collection: "merchant_inventory", docId: merchantId,
        oldValue: invDoc.exists ? { entries: invData.entries, totalCards: invData.totalCards, totalValue: invData.totalValue } : null,
        newValue: { entries: newEntries, totalCards: newTotalCards, totalValue: newTotalValue },
        performedBy: "admin", reason: "إضافة عهدة", timestamp: now, date, time,
      });

      const notifRef = db.collection("merchant_notifications").doc();
      transaction.set(notifRef, {
        merchantId, type: "inventory_added", title: "إضافة عهدة",
        message: `تم إضافة ${totalCards} كرت بقيمة ${totalValue.toLocaleString("ar-SA")} ج.م`,
        read: false, createdAt: now,
      });
    });

    $("invModal").classList.remove("open");
    await loadMerchants();
    if (typeof markAccountsDirty === "function") markAccountsDirty();
    if (typeof refreshAccountsUI === "function") await refreshAccountsUI();
    if (typeof currentMerchantProfileId !== "undefined" && currentMerchantProfileId === merchantId) {
      if (typeof refreshMerchantProfile === "function") await refreshMerchantProfile();
    }
    showToast("✅ تم إضافة العهدة بنجاح", "success");
  } catch (err) {
    showToast("خطأ في حفظ العهدة: " + err.message, "error");
  }
}

// ===== Card Price Management =====

async function openCardPriceModal() {
  await loadInventoryPrices();
  renderCardPriceList();
  $("cardPriceModal").classList.add("open");
}

function renderCardPriceList() {
  const container = $("cardPriceList");
  if (!container) return;

  if (!inventoryCardPrices.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px;">لا توجد فئات أسعار. أضف الفئة الأولى.</p>';
    return;
  }

  container.innerHTML = inventoryCardPrices.map((p, i) => `
    <div class="cp-row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);" data-index="${i}">
      <input type="text" class="cp-category" value="${escapeHtml(p.category)}" placeholder="اسم الفئة"
        style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;background:var(--surface);color:var(--text);" />
      <input type="number" class="cp-price" value="${p.merchantPrice || 0}" min="0" step="0.01" placeholder="السعر"
        style="width:100px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;text-align:center;background:var(--surface);color:var(--text);" />
      <input type="number" class="cp-sort" value="${p.sortOrder || i}" min="0" placeholder="ترتيب"
        style="width:60px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;text-align:center;background:var(--surface);color:var(--text);" />
      <button class="btn btn-sm" onclick="removeCardPriceRow(this)" style="background:var(--danger);color:white;border:none;padding:6px 10px;border-radius:var(--radius-xs);cursor:pointer;">×</button>
    </div>
  `).join("");
}

function addCardPriceRow() {
  const container = $("cardPriceList");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "cp-row";
  div.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);";
  div.innerHTML = `
    <input type="text" class="cp-category" value="" placeholder="اسم الفئة"
      style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;background:var(--surface);color:var(--text);" />
    <input type="number" class="cp-price" value="0" min="0" step="0.01" placeholder="السعر"
      style="width:100px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;text-align:center;background:var(--surface);color:var(--text);" />
    <input type="number" class="cp-sort" value="0" min="0" placeholder="ترتيب"
      style="width:60px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:14px;text-align:center;background:var(--surface);color:var(--text);" />
    <button class="btn btn-sm" onclick="removeCardPriceRow(this)" style="background:var(--danger);color:white;border:none;padding:6px 10px;border-radius:var(--radius-xs);cursor:pointer;">×</button>
  `;
  container.appendChild(div);
}

function removeCardPriceRow(btn) {
  const row = btn.closest(".cp-row");
  if (row) row.remove();
}

async function saveCardPrices() {
  const rows = document.querySelectorAll("#cardPriceList .cp-row");
  const prices = [];
  let hasErrors = false;

  rows.forEach((row) => {
    const category = row.querySelector(".cp-category")?.value?.trim();
    const merchantPrice = parseFloat(row.querySelector(".cp-price")?.value) || 0;
    const sortOrder = parseInt(row.querySelector(".cp-sort")?.value) || 0;

    if (!category) { showToast("جميع فئات الأسعار يجب أن تحتوي على اسم", "warning"); hasErrors = true; return; }
    if (merchantPrice < 0) { showToast("السعر لا يمكن أن يكون سالباً", "warning"); hasErrors = true; return; }
    prices.push({ category, merchantPrice, sortOrder });
  });
  if (hasErrors) return;

  if (!prices.length) { showToast("يرجى إضافة فئة سعر واحدة على الأقل", "warning"); return; }

  try {
    const snap = await db.collection("merchant_card_prices").get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    prices.forEach((p) => {
      const ref = db.collection("merchant_card_prices").doc();
      batch.set(ref, p);
    });
    await batch.commit();

    await loadInventoryPrices();
    if (typeof markAccountsDirty === "function") markAccountsDirty();
    $("cardPriceModal").classList.remove("open");
    showToast("✅ تم حفظ أسعار الكروت بنجاح", "success");
  } catch (err) {
    showToast("خطأ في حفظ الأسعار: " + err.message, "error");
  }
}

window.openAddInventoryModal = openAddInventoryModal;
window.saveInventory = saveInventory;
window.openCardPriceModal = openCardPriceModal;
window.addCardPriceRow = addCardPriceRow;
window.removeCardPriceRow = removeCardPriceRow;
window.saveCardPrices = saveCardPrices;
