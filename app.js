const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwPAcqImmlY9q52rv5pZI5BEIlxN-k0tn1BqIrSz6C2ruvZ65j9evNnY5E9k_Y0ANRc/exec";

let appData = {
    categories: [],
    containers: [],
    hazards: [],
    pendingCount: 0,
    pendingList: []
};

let currentView = {
    level: 1, // 1: 四大分類, 2: 該分類容器列表, 3: 容器詳細資訊
    categoryId: null,
    containerId: null
};

let isAdminLoggedIn = false;
let debounceTimer = null;

// 確保 DOM 載入完成後才執行初始同步
document.addEventListener("DOMContentLoaded", () => {
    const cached = localStorage.getItem("app_data_cache");
    if (cached) {
        try {
            appData = JSON.parse(cached);
            renderCurrentView();
        } catch(e) {}
    }
    
    // 檢查網址是否帶有 containerId 參數（QR Code 掃描直接導向第三層）
    const urlParams = new URLSearchParams(window.location.search);
    const targetContainerId = urlParams.get("containerId");
    if (targetContainerId) {
        currentView.level = 3;
        currentView.containerId = targetContainerId;
    }

    fetchLatestData();
}););

// 非同步取得最新資料（跨裝置同步，無閃頻）
async function fetchLatestData() {
    try {
        const res = await fetch(`${GAS_API_URL}?action=getData`);
        const json = await res.json();
        if (json.status === "success") {
            appData = json.data;
            localStorage.setItem("app_data_cache", JSON.stringify(appData));
            updatePendingBadge();
            renderCurrentView();
        }
    } catch (err) {
        console.error("同步資料失敗:", err);
    }
}

function updatePendingBadge() {
    const badge = document.getElementById("pendingBadge");
    
    // 【關鍵防呆】如果畫面還沒長出來、找不到這個元素，就直接返回，不執行後面動作
    if (!badge) return; 
    
    if (appData.pendingCount > 0) {
        badge.style.display = "inline-block";
        badge.innerText = appData.pendingCount;
    } else {
        badge.style.display = "none";
    }
}

// 根據目前層級渲染畫面
function renderCurrentView() {
    const main = document.getElementById("appMain");
    const backBtn = document.getElementById("backBtn");
    
    if (currentView.level > 1) {
        backBtn.style.display = "inline-block";
    } else {
        backBtn.style.display = "none";
    }

    if (currentView.level === 1) {
        renderLevel1(main);
    } else if (currentView.level === 2) {
        renderLevel2(main, currentView.categoryId);
    } else if (currentView.level === 3) {
        renderLevel3(main, currentView.containerId);
    }
}

// 第一層：顯示四大分類（以該分類第一個容器做代表）
function renderLevel1(container) {
    let html = `
        <input type="text" id="searchInput" class="search-bar" placeholder="搜尋容器關鍵字..." oninput="handleSearchInput(this.value)">
        <div class="action-toolbar">
            <button class="nav-btn" onclick="exportAllSigns()">匯出所有標誌 PDF</button>
            <button class="nav-btn" onclick="exportSearchedSigns()">匯出搜尋標誌 PDF</button>
        </div>
        <div id="contentArea" class="grid-container">
    `;

    appData.categories.forEach(cat => {
        // 找出該分類的第一個容器作為代表
        const firstContainer = appData.containers.find(c => c.categoryId === cat.categoryId);
        const iconUrl = firstContainer ? firstContainer.iconUrl : (cat.representativeIconUrl || "");
        
        html += `
            <div class="card" onclick="enterLevel2('${cat.categoryId}')">
                <div class="card-top-row">
                    <img class="card-icon" src="${iconUrl}" alt="分類代表圖示">
                    <div class="card-qrcode"><span>分類封面</span></div>
                </div>
                <h3>${cat.categoryName}</h3>
                <div class="card-desc">點擊進入瀏覽該分類所有容器</div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;
}

// 300ms 防抖搜尋處理
function handleSearchInput(keyword) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        const contentArea = document.getElementById("contentArea");
        if (!contentArea) return;
        
        const trimmed = keyword.trim().toLowerCase();
        if (!trimmed) {
            renderLevel1(document.getElementById("appMain"));
            return;
        }

        const matchedContainers = appData.containers.filter(c => 
            c.containerName.toLowerCase().includes(trimmed) || 
            c.signDescription.toLowerCase().includes(trimmed)
        );

        let html = "";
        matchedContainers.forEach(c => {
            const qrTargetUrl = `${window.location.origin}${window.location.pathname}?containerId=${c.containerId}`;
            html += `
                <div class="card" onclick="enterLevel3('${c.containerId}')">
                    <div class="card-top-row">
                        <img class="card-icon" src="${c.iconUrl}" alt="標誌圖示">
                        <div class="card-qrcode" id="qr_search_${c.containerId}"></div>
                    </div>
                    <h3>${c.containerName}</h3>
                    <div class="card-desc">${c.signDescription}</div>
                </div>
            `;
        });
        contentArea.innerHTML = html || "<p>查無符合關鍵字的容器。</p>";

        // 生成 QR Code
        matchedContainers.forEach(c => {
            const el = document.getElementById(`qr_search_${c.containerId}`);
            if (el && el.childElementCount === 0) {
                const qrTargetUrl = `${window.location.origin}${window.location.pathname}?containerId=${c.containerId}`;
                new QRCode(el, { text: qrTargetUrl, width: 84, height: 84 });
            }
        });
    }, 300);
}

// 第二層：顯示該分類所有容器
function enterLevel2(categoryId) {
    currentView.level = 2;
    currentView.categoryId = categoryId;
    renderCurrentView();
}

function renderLevel2(container, categoryId) {
    const list = appData.containers.filter(c => c.categoryId === categoryId);
    
    let html = `
        <h2>分類容器清單</h2>
        <div class="action-toolbar">
            <button class="nav-btn" onclick="exportSearchedSigns()">匯出當前清單 PDF</button>
        </div>
        <div class="grid-container">
    `;

    list.forEach(c => {
        html += `
            <div class="card" onclick="enterLevel3('${c.containerId}')">
                <div class="card-top-row">
                    <img class="card-icon" src="${c.iconUrl}" alt="容器圖示">
                    <div class="card-qrcode" id="qr_l2_${c.containerId}"></div>
                </div>
                <h3>${c.containerName}</h3>
                <div class="card-desc">${c.signDescription}</div>
            </div>
        `;
    });

    html += `</div>`;
    container.innerHTML = html;

    // 渲染 QR Code
    list.forEach(c => {
        const el = document.getElementById(`qr_l2_${c.containerId}`);
        if (el && el.childElementCount === 0) {
            const qrTargetUrl = `${window.location.origin}${window.location.pathname}?containerId=${c.containerId}`;
            new QRCode(el, { text: qrTargetUrl, width: 84, height: 84 });
        }
    });
}

// 第三層：顯示容器詳細資訊與五大危害控制
function enterLevel3(containerId) {
    currentView.level = 3;
    currentView.containerId = containerId;
    renderCurrentView();
}

function renderLevel3(container, containerId) {
    const c = appData.containers.find(x => x.containerId === containerId);
    if (!c) {
        container.innerHTML = "<p>找不到該容器資訊。</p>";
        return;
    }

    const isWarning = String(c.isWarningSign).toUpperCase() === "TRUE";

    let html = `
        <div class="card" style="cursor: default; margin-bottom: 20px;">
            <div class="card-top-row">
                <img class="card-icon" src="${c.iconUrl}" style="width: 120px; height: 120px;" alt="容器圖示">
                <div class="card-qrcode" id="qr_l3_${c.containerId}" style="width: 120px; height: 120px;"></div>
            </div>
            <h2>${c.containerName}</h2>
            <div class="card-desc" style="font-size: 1rem;">${c.signDescription}</div>
        </div>
    `;

    if (isWarning) {
        html += `<h3>職業安全衛生五大危害控制措施</h3><div id="hazardsListArea">`;
        const standardHazards = [
            "消除 (Elimination)",
            "取代 (Substitution)",
            "工程控制 (Engineering Controls)",
            "行政管理 (Administrative Controls)",
            "個人防護具 (PPE)"
        ];

        standardHazards.forEach(hType => {
            const hazardObj = appData.hazards.find(h => h.containerId === c.containerId && h.hazardType === hType);
            const content = hazardObj ? hazardObj.controlContent : "";

            html += `
                <div class="hazard-box">
                    <div class="hazard-info" style="flex-grow: 1;">
                        <h4>${hType}</h4>
                        <div class="hazard-content" id="content_${c.containerId}_${hType}">${content || "(尚無內容)"}</div>
                    </div>
            `;

            if (isAdminLoggedIn) {
                html += `<button class="nav-btn" onclick="adminEditHazard('${c.containerId}', '${hType}')">直接編輯</button>`;
            } else {
                html += `<button class="nav-btn" onclick="requestAddHazard('${c.containerId}', '${hType}')">新增</button>`;
            }

            html += `</div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;

    // 渲染專屬 QR Code (永久固定不變)
    const qrEl = document.getElementById(`qr_l3_${c.containerId}`);
    if (qrEl && qrEl.childElementCount === 0) {
        const qrTargetUrl = `${window.location.origin}${window.location.pathname}?containerId=${c.containerId}`;
        new QRCode(qrEl, { text: qrTargetUrl, width: 114, height: 114 });
    }
}

// 返回上一步
function goBack() {
    if (currentView.level === 3) {
        currentView.level = 2;
        currentView.containerId = null;
    } else if (currentView.level === 2) {
        currentView.level = 1;
        currentView.categoryId = null;
    }
    renderCurrentView();
}

function refreshApp() {
    window.location.href = window.location.pathname;
}

// 匯出 PDF 功能（透過瀏覽器列印機制結合 CSS 媒體查詢）
function exportAllSigns() {
    window.print();
}

function exportSearchedSigns() {
    window.print();
}

// --- 管理員與互動審批邏輯 ---
function openAdminModal() {
    document.getElementById("adminModal").style.display = "flex";
}
function closeAdminModal() {
    document.getElementById("adminModal").style.display = "none";
}

async function loginAdmin() {
    const pwd = document.getElementById("adminPwdInput").value;
    try {
        const res = await fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "loginAdmin", password: pwd })
        });
        const json = await res.json();
        if (json.success) {
            isAdminLoggedIn = true;
            document.getElementById("adminAuthSection").style.display = "none";
            document.getElementById("adminDashboardSection").style.display = "block";
            alert("管理者登入成功！");
            renderCurrentView();
        } else {
            alert("密碼錯誤！");
        }
    } catch(err) {
        alert("登入請求失敗");
    }
}

function openChangePwdModal() { document.getElementById("changePwdModal").style.display = "flex"; }
function closeChangePwdModal() { document.getElementById("changePwdModal").style.display = "none"; }

async function submitChangePassword() {
    const oldP = document.getElementById("oldPwdInput").value;
    const newP = document.getElementById("newPwdInput").value;
    const res = await fetch(GAS_API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "changePassword", oldPassword: oldP, newPassword: newP })
    });
    const json = await res.json();
    if (json.success) {
        alert("密碼變更成功！舊密碼已失效。");
        closeChangePwdModal();
    } else {
        alert("舊密碼不正確，變更失敗。");
    }
}

function openAddSignModal() { document.getElementById("addSignModal").style.display = "flex"; }
function closeAddSignModal() { document.getElementById("addSignModal").style.display = "none"; }

async function submitNewSign(e) {
    e.preventDefault();
    const data = {
        action: "addSign",
        categoryId: document.getElementById("newCategoryId").value,
        containerName: document.getElementById("newContainerName").value,
        signDescription: document.getElementById("newSignDesc").value,
        iconUrl: document.getElementById("newIconUrl").value,
        isWarningSign: document.getElementById("newIsWarning").value
    };

    const res = await fetch(GAS_API_URL, { method: "POST", body: JSON.stringify(data) });
    const json = await res.json();
    if (json.status === "success") {
        alert("新增標誌成功！");
        closeAddSignModal();
        fetchLatestData();
    } else {
        alert("新增失敗: " + json.message);
    }
}

// 管理員直接編輯五大危害
async function adminEditHazard(containerId, hazardType) {
    const currentObj = appData.hazards.find(h => h.containerId === containerId && h.hazardType === hazardType);
    const val = prompt(`直接編輯 [${hazardType}] 內容:`, currentObj ? currentObj.controlContent : "");
    if (val === null) return;

    const res = await fetch(GAS_API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "editHazard", containerId, hazardType, controlContent: val })
    });
    const json = await res.json();
    if (json.status === "success") {
        alert("更新成功！");
        fetchLatestData();
    }
}

// 非管理員提出審批請求
async function requestAddHazard(containerId, hazardType) {
    const val = prompt(`請輸入您想為 [${hazardType}] 新增的內容（送審後需管理員核准）：`);
    if (!val) return;

    const res = await fetch(GAS_API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "requestApproval", containerId, hazardType, requestedContent: val })
    });
    const json = await res.json();
    if (json.status === "success") {
        alert("已成功送出審批請求，等待管理員核准。");
    }
}

// 查看待審批清單
async function openApprovalListModal() {
    const res = await fetch(`${GAS_API_URL}?action=getPending`);
    const json = await res.json();
    const container = document.getElementById("approvalListContainer");
    
    if (json.status === "success" && json.data.length > 0) {
        let html = "";
        json.data.forEach(item => {
            html += `
                <div class="hazard-box" style="margin-bottom: 15px;">
                    <div>
                        <strong>容器代號:</strong> ${item.containerId}<br>
                        <strong>危害項目:</strong> ${item.hazardType}<br>
                        <strong>申請新增內容:</strong> ${item.requestedContent}<br>
                        <small>時間: ${item.timestamp}</small>
                    </div>
                    <div>
                        <button class="nav-btn" style="background: var(--success-color); color:#fff;" onclick="handleApproval('${item.id}', 'approve')">核准</button>
                        <button class="nav-btn" style="background: var(--danger-color); color:#fff;" onclick="handleApproval('${item.id}', 'reject')">拒絕</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    } else {
        container.innerHTML = "<p>目前沒有待審批的項目。</p>";
    }
    document.getElementById("approvalListModal").style.display = "flex";
}
function closeApprovalListModal() { document.getElementById("approvalListModal").style.display = "none"; }

async function handleApproval(id, decision) {
    const res = await fetch(GAS_API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "handleApproval", id, decision })
    });
    const json = await res.json();
    if (json.status === "success") {
        alert(decision === "approve" ? "已核准，內容已自動串接合併！" : "已拒絕該申請。");
        openApprovalListModal();
        fetchLatestData();
    }
}
