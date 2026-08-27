// 請替換為您的 Google Apps Script 部署後的 Web App URL
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbzJ1NShDRiL1wG2yYvLL4Jf7cHi7qAniHX8qCAUGn3YZ-7cbGUtZiarWvB6381yH1po/exec";

class App {
    constructor() {
        this.signs = [];
        this.pendingCount = 0;
        this.currentLayer = 1;
        this.currentCategory = null;
        this.currentSignId = null;
        this.isAdmin = false;
        this.searchQuery = "";
        this.debounceTimer = null;
        this.historyStack = []; // 紀錄瀏覽狀態以支援返回上一步

        this.init();
    }

    async init() {
        // 1. 優先取得網址帶有的 signId
        const urlParams = new URLSearchParams(window.location.search);
        let targetSignId = urlParams.get("signId");

        if (!targetSignId && window.location.hash) {
            targetSignId = window.location.hash.replace("#", "");
        }

        // 2. 開始從 GAS 抓取資料
        await this.fetchData(true); 

        // 3. 【防呆關鍵】如果遠端資料剛好還沒回來（陣列為空），最多等待 3 秒鐘讓它抓完
        let retryCount = 0;
        while (this.signs.length === 0 && retryCount < 30) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 每 100ms 檢查一次
            retryCount++;
        }

        // 4. 資料到齊後，正式進行導向或渲染
        if (targetSignId) {
            const found = this.signs.find(s => String(s.ID).trim() === String(targetSignId).trim());
            if (found) {
                this.goToLayer3(found.ID, false);
                return;
            } else {
                console.warn(`找不到指定的標誌 ID: ${targetSignId}`);
            }
        }

        this.renderLayer1();
    }

    // 從 GAS 取得最新資料 (背景靜默同步，拒絕閃頻)
    async fetchData(isSilent = false) {
        try {
            const response = await fetch(`${GAS_API_URL}?action=getData`);
            const result = await response.json();
            if (result.status === "success") {
                this.signs = result.signs;
                this.pendingCount = result.pendingCount;
                this.updatePendingBadge();
                if (!isSilent && this.currentLayer === 1) {
                    this.renderLayer1();
                }
            }
        } catch (err) {
            console.error("同步資料失敗:", err);
        }
    }

    updatePendingBadge() {
        const container = document.getElementById("pending-badge-container");
        if (this.pendingCount > 0 && this.isAdmin) {
            container.innerHTML = `<span class="badge-pending-count">${this.pendingCount}</span>`;
        } else {
            container.innerHTML = "";
        }
    }

    // --- SPA 路由與層級控制 ---
    switchLayer(layerNum) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-layer-${layerNum}`).classList.add('active');
        this.currentLayer = layerNum;

        // 控制「返回上一步」按鈕顯示
        const btnBack = document.getElementById("btn-back");
        if (layerNum === 1) {
            btnBack.style.display = "none";
        } else {
            btnBack.style.display = "inline-block";
        }
    }

    goBack() {
        if (this.historyStack.length > 0) {
            const prevState = this.historyStack.pop();
            this.currentLayer = prevState.layer;
            this.currentCategory = prevState.category;
            this.currentSignId = prevState.signId;

            if (this.currentLayer === 1) this.renderLayer1();
            else if (this.currentLayer === 2) this.renderLayer2(this.currentCategory, false);
            else if (this.currentLayer === 3) this.goToLayer3(this.currentSignId, false);
            
            this.switchLayer(this.currentLayer);
        } else {
            this.refreshHome();
        }
    }

    refreshHome() {
        this.historyStack = [];
        this.currentCategory = null;
        this.currentSignId = null;
        document.getElementById("search-input").value = "";
        this.searchQuery = "";
        this.fetchData(false);
        this.switchLayer(1);
        this.renderLayer1();
    }

    // --- 第一層：四大分類檢視 ---
    renderLayer1() {
        this.switchLayer(1);
        const grid = document.getElementById("category-grid");
        
        // 取得四大分類
        const categories = [...new Set(this.signs.map(s => s.Category))];
        
        let html = "";
        categories.forEach(cat => {
            // 找出該分類的第一個標誌容器做代表
            const firstSign = this.signs.find(s => s.Category === cat);
            if (!firstSign) return;

            html += `
                <div class="card" onclick="app.goToLayer2('${cat}')">
                    <img class="sign-icon" src="${firstSign.IconUrl}" alt="${cat}">
                    <div class="qr-box" id="qr-cat-${firstSign.ID}"></div>
                    <h3>${cat}</h3>
                    <p>點擊查看所有容器</p>
                </div>
            `;
        });
        grid.innerHTML = html;

        // 渲染代表容器的 QRcode
        categories.forEach(cat => {
            const firstSign = this.signs.find(s => s.Category === cat);
            if (firstSign) {
                const qrContainer = document.getElementById(`qr-cat-${firstSign.ID}`);
                if (qrContainer && qrContainer.childElementCount === 0) {
                    // 確保 QR Code 產生的網址絕對正確且帶有正確的 GitHub Pages 根目錄
const basePath = window.location.origin + window.location.pathname;
const targetUrl = `${basePath}?signId=${sign.ID}`;
                    new QRCode(qrContainer, { text: targetUrl, width: 64, height: 64 });
                }
            }
        });
    }

    // --- 搜尋功能 (帶 300ms 防抖) ---
    handleSearchInput(event) {
        clearTimeout(this.debounceTimer);
        const query = event.target.value.trim();
        this.debounceTimer = setTimeout(() => {
            this.searchQuery = query;
            if (query.length > 0) {
                // 有搜尋字詞時，直接顯示符合關鍵字的容器列表 (以第二層介面呈現)
                this.renderSearchResults(query);
            } else {
                this.renderLayer1();
            }
        }, 300);
    }

    renderSearchResults(query) {
        this.switchLayer(2);
        document.getElementById("layer2-titleinnerText") = `搜尋結果: "${query}"`;
        const matched = this.signs.filter(s => 
            s.Name.toLowerCase().includes(query.toLowerCase()) || 
            s.Description.toLowerCase().includes(query.toLowerCase()) ||
            s.Category.toLowerCase().includes(query.toLowerCase())
        );
        this.renderSignsGrid(matched);
    }

    // --- 第二層：分類容器列表 ---
    goToLayer2(category) {
        this.historyStack.push({ layer: this.currentLayer, category: this.currentCategory, signId: this.currentSignId });
        this.currentCategory = category;
        this.renderLayer2(category, true);
    }

    renderLayer2(category, pushHistory = true) {
        this.switchLayer(2);
        document.getElementById("layer2-title").innerText = `${category} - 容器列表`;
        const filtered = this.signs.filter(s => s.Category === category);
        this.renderSignsGrid(filtered);
    }

    renderSignsGrid(signsList) {
        const grid = document.getElementById("signs-grid");
        let html = "";
        signsList.forEach(sign => {
            html += `
                <div class="card" onclick="app.goToLayer3('${sign.ID}', true)">
                    <img class="sign-icon" src="${sign.IconUrl}" alt="${sign.Name}">
                    <div class="qr-box" id="qr-sign-${sign.ID}"></div>
                    <h3>${sign.Name}</h3>
                    <p>${sign.Description}</p>
                </div>
            `;
        });
        grid.innerHTML = html;

        // 生成獨特 QRcode (掃描直達第三層)
        signsList.forEach(sign => {
            const qrContainer = document.getElementById(`qr-sign-${sign.ID}`);
            if (qrContainer && qrContainer.childElementCount === 0) {
                // 確保 QR Code 產生的網址絕對正確且帶有正確的 GitHub Pages 根目錄
const basePath = window.location.origin + window.location.pathname;
const targetUrl = `${basePath}?signId=${sign.ID}`;
                new QRCode(qrContainer, { text: targetUrl, width: 72, height: 72 });
            }
        });
    }

    // --- 第三層：容器詳細資訊與 5 大危害控制措施 ---
    goToLayer3(signId, pushHistory = true) {
        if (pushHistory) {
            this.historyStack.push({ layer: this.currentLayer, category: this.currentCategory, signId: this.currentSignId });
        }
        this.currentSignId = signId;
        this.switchLayer(3);

        const sign = this.signs.find(s => s.ID === signId);
        const container = document.getElementById("detail-content");
        if (!sign) {
            container.innerHTML = "<p>找不到該容器資訊</p>";
            return;
        }

        let measuresHtml = "";
        // 假設分類為「注意」才顯示 5 大危害控制措施
        if (sign.Category === "Warning sign") {
            const measures = sign.Measures ? sign.Measures.split("||") : ["", "", "", "", ""];
            const titles = ["1. 工程控制", "2. 行政管理", "3. 個人防護具", "4. 教育訓練", "5. 應變處置"];
            
            measuresHtml = `<h3>5 大危害控制措施</h3><div class="measures-grid">`;
            for (let i = 0; i < 5; i++) {
                const val = measures[i] || "";
                if (this.isAdmin) {
                    // 管理員可直接編輯，無須審批
                    measuresHtml += `
                        <div class="measure-card">
                            <div class="measure-content">
                                <strong>${titles[i]}</strong><br>
                                <input type="text" id="measure-edit-${i}" value="${val}" style="width:100%; margin-top:5px; padding:6px;">
                            </div>
                            <button onclick="app.saveMeasureDirect('${sign.ID}', ${i})">儲存</button>
                        </div>
                    `;
                } else {
                    // 一般使用者：框格呈現，右側有新增按鈕 (送出審批)
                    measuresHtml += `
                        <div class="measure-card">
                            <div class="measure-content">
                                <strong>${titles[i]}</strong><br>
                                <span>${val || "（目前無額外填寫內容）"}</span>
                            </div>
                            <button onclick="app.openAddProposalModal('${sign.ID}', ${i}, '${titles[i]}')">新增</button>
                        </div>
                    `;
                }
            }
            measuresHtml += `</div>`;
        }

        container.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <img src="${sign.IconUrl}" style="width: 100px; height: 100px; object-fit: contain;">
                <h2>${sign.Name}</h2>
                <div id="qr-detail-${sign.ID}" style="display:inline-block; margin: 10px 0;"></div>
                <p>${sign.Description}</p>
            </div>
            ${measuresHtml}
        `;

        const qrContainer = document.getElementById(`qr-detail-${sign.ID}`);
        if (qrContainer && qrContainer.childElementCount === 0) {
           // 確保 QR Code 產生的網址絕對正確且帶有正確的 GitHub Pages 根目錄
const basePath = window.location.origin + window.location.pathname;
const targetUrl = `${basePath}?signId=${sign.ID}`;
            new QRCode(qrContainer, { text: targetUrl, width: 90, height: 90 });
        }
    }

    // --- 使用者提交審批申請 ---
    openAddProposalModal(signId, measureIndex, measureTitle) {
        const content = prompt(`請輸入您想在「${measureTitle}」新增的內容：`);
        if (!content || content.trim() === "") return;

        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "submitMeasure",
                signId: signId,
                measureIndex: measureIndex,
                content: content.trim()
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                alert("已成功送出申請，等待管理員審批後生效！");
            } else {
                alert("送出失敗：" + res.message);
            }
        });
    }

    // --- 管理員直接編輯控制措施 ---
    saveMeasureDirect(signId, measureIndex) {
        const newVal = document.getElementById(`measure-edit-${measureIndex}`).value;
        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "updateMeasureDirect",
                signId: signId,
                measureIndex: measureIndex,
                content: newVal
            })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                alert("已直接更新控制措施（已記錄 Log）");
                this.fetchData(true).then(() => this.goToLayer3(signId, false));
            } else {
                alert("更新失敗：" + res.message);
            }
        });
    }

    // --- 管理者中心與登入邏輯 ---
    openAdminModal() {
        document.getElementById("admin-modal").classList.add("active");
        if (this.isAdmin) {
            document.getElementById("admin-login-box").style.display = "none";
            document.getElementById("admin-dashboard-box").style.display = "block";
        } else {
            document.getElementById("admin-login-box").style.display = "block";
            document.getElementById("admin-dashboard-box").style.display = "none";
        }
    }

    closeModal() {
        document.querySelectorAll('.modal').forEach(el => el.classList.remove('active'));
    }

    adminLogin() {
        const pwd = document.getElementById("admin-password-input").value;
        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "login", password: pwd })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success" && res.authenticated) {
                this.isAdmin = true;
                alert("登入成功！");
                this.closeModal();
                this.updatePendingBadge();
                if (this.currentLayer === 3) this.goToLayer3(this.currentSignId, false);
            } else {
                alert("登入失敗：" + (res.message || "密碼錯誤"));
            }
        });
    }

    adminLogout() {
        this.isAdmin = false;
        alert("已登出");
        this.closeModal();
        this.updatePendingBadge();
        if (this.currentLayer === 3) this.goToLayer3(this.currentSignId, false);
    }

    // --- 查閱審批清單 ---
    async openPendingListModal() {
        this.closeModal();
        const res = await fetch(`${GAS_API_URL}?action=getPending`);
        const data = await res.json();
        
        const container = document.getElementById("pending-list-container");
        if (!data.pending || data.pending.length === 0) {
            container.innerHTML = "<p>目前沒有待審批的項目。</p>";
        } else {
            let html = "";
            data.pending.forEach(item => {
                const sign = this.signs.find(s => s.ID === item.signId);
                const signName = sign ? sign.Name : item.signId;
                html += `
                    <div style="border-bottom: 1px solid #ddd; padding: 10px 0; display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <strong>標誌：${signName}</strong><br>
                            <span>欲新增內容：${item.proposedContent}</span><br>
                            <small style="color:#777;">提交時間：${item.submittedAt}</small>
                        </div>
                        <div>
                            <button onclick="app.handleApproval('${item.id}', true)">核准</button>
                            <button class="btn-secondary" onclick="app.handleApproval('${item.id}', false)">拒絕</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
        document.getElementById("pending-modal").classList.add("active");
    }

    handleApproval(pendingId, isApproved) {
        const actionType = isApproved ? "approvePending" : "rejectPending";
        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({ action: actionType, pendingId: pendingId })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                alert(res.message);
                this.fetchData(true);
                this.closeModal();
            } else {
                alert("操作失敗：" + res.message);
            }
        });
    }

    // --- 新增號誌 (管理員專用) ---
    openAddSignModal() {
        const id = prompt("請輸入新號誌 ID (例如 S999)：");
        if (!id) return;
        const category = prompt("請輸入四大分類名稱：");
        if (!category) return;
        const name = prompt("請輸入標誌名稱：");
        if (!name) return;
        const iconUrl = prompt("請輸入圖示網址 (例如 https://lh3.googleusercontent.com/d/...)：");
        if (!iconUrl) return;
        const description = prompt("請輸入標誌詳細說明：");
        if (!description) return;

        let measures = "";
        if (sign.Category === "Warning sign") {
            measures = prompt("此為警告/注意分類，請輸入 5 大危害控制措施 (各措施請用 || 隔開，可留空)：") || "";
        }

        const signData = { id, category, name, iconUrl, qrCodeUrl: "", description, measures };

        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "addSign", signData: signData })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                alert("新增號誌成功！");
                this.fetchData(false);
                this.closeModal();
            } else {
                alert("新增失敗：" + res.message);
            }
        });
    }

    // --- 更改密碼 ---
    openChangePasswordModal() {
        const oldPassword = prompt("請輸入原管理者密碼：");
        if (!oldPassword) return;
        const newPassword = prompt("請輸入新管理者密碼：");
        if (!newPassword) return;

        fetch(GAS_API_URL, {
            method: "POST",
            body: JSON.stringify({ action: "changePassword", oldPassword, newPassword })
        })
        .then(res => res.json())
        .then(res => {
            if (res.status === "success") {
                alert(res.message);
                this.closeModal();
            } else {
                alert("變更失敗：" + res.message);
            }
        });
    }

    // --- 前端 PDF 匯出 (利用瀏覽器端列印機制) ---
    exportAllPDF() {
        window.print();
    }
}

// 啟動應用程式
const app = new App();
