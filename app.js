// GAS 部署網址（請填入您在 Module 1 部署的 Web App 網址）
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbwPAcqImmlY9q52rv5pZI5BEIlxN-k0tn1BqIrSz6C2ruvZ65j9evNnY5E9k_Y0ANRc/exec";

class App {
    constructor() {
        this.data = { containers: [], hazards: {}, pendingApprovals: [] };
        this.currentCategory = null;
        this.currentContainerId = null;
        this.isAdmin = false;
        this.searchTimer = null;
        this.historyStack = [];

        this.init();
    }

    async init() {
        // 1. 先從 IndexedDB 載入快取渲染（零閃頻）
        await this.loadFromCache();

        // 2. 路由監聽 (Hash Router 確保 QR Code 掃描直接進入第三層)
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();

        // 3. 背景非同步向 GAS 抓取最新資料
        this.fetchLatestData();
    }

    async fetchLatestData() {
        try {
            const res = await fetch(GAS_API_URL + "?action=getData");
            const json = await res.json();
            if (json.status === "success") {
                this.data = json;
                await this.saveToCache(json);
                this.updatePendingBadge();
                this.handleRoute();
            }
        } catch (err) {
            console.warn("網路連線離線，使用本地快取資料", err);
        }
    }

    // Hash Router 解析
    handleRoute() {
        const hash = window.location.hash;
        if (hash.startsWith("#/detail/")) {
            const containerId = hash.replace("#/detail/", "");
            this.currentContainerId = containerId;
            this.showLayer(3);
        } else if (hash.startsWith("#/category/")) {
            const category = decodeURIComponent(hash.replace("#/category/", ""));
            this.currentCategory = category;
            this.showLayer(2);
        } else {
            this.showLayer(1);
        }
    }

    showLayer(layerNum) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-layer-${layerNum}`).classList.add('active');
        document.getElementById('global-toolbar').style.display = layerNum === 1 ? 'none' : 'flex';
        document.getElementById('home-toolbar').style.display = layerNum === 1 ? 'flex' : 'none'; // 只有首頁才顯示匯出按鈕
        
        if (layerNum === 1) {
            this.renderLayer1();
        } else if (layerNum === 2) {
            this.renderLayer2();
        } else if (layerNum === 3) {
            this.renderLayer3();
        }
    }

    // 第一層渲染：四大分類
    renderLayer1() {
        const grid = document.getElementById('category-grid');
        const categories = [...new Set(this.data.containers.map(c => c.category))];
        
        grid.innerHTML = categories.map(cat => {
            const firstContainer = this.data.containers.find(c => c.category === cat);
            return `
                <div class="card" onclick="app.navigateToCategory('${cat}')">
                    <img src="${firstContainer ? firstContainer.iconUrl : ''}" alt="${cat}">
                    <h3>${cat}</h3>
                </div>
            `;
        }).join('');
    }

    navigateToCategory(cat) {
        window.location.hash = `#/category/${encodeURIComponent(cat)}`;
    }

    // 第二層渲染：該分類所有容器
    renderLayer2() {
        document.getElementById('layer2-title').innerText = `分類：${this.currentCategory}`;
        const grid = document.getElementById('container-grid');
        const filtered = this.data.containers.filter(c => c.category === this.currentCategory);

        grid.innerHTML = filtered.map(c => `
            <div class="card" onclick="app.navigateToDetail('${c.id}')">
                <img src="${c.iconUrl}" alt="${c.name}">
                <h3>${c.name}</h3>
            </div>
        `).join('');
    }

    navigateToDetail(id) {
        window.location.hash = `#/detail/${id}`;
    }

    // 第三層渲染：容器詳情、圖示、QRcode 與 5大危害控制
    renderLayer3() {
        const container = this.data.containers.find(c => c.id === this.currentContainerId);
        const detailBox = document.getElementById('detail-content');
        
        if (!container) {
            detailBox.innerHTML = `<p>找不到該容器資料</p>`;
            return;
        }

        const currentUrl = window.location.href;
        const isWarning = container.category.toLowerCase().includes("warning sign");
        const hazards = this.data.hazards[container.id] || ["", "", "", "", ""];

        detailBox.innerHTML = `
            <div class="flex-row">
                <img src="${container.iconUrl}" alt="${container.name}">
                <div style="flex-grow: 1; margin-left: 16px;">
                    <h2>${container.name}</h2>
                    <p style="color: #64748b; font-size: 0.9rem; margin-top: 4px;">${container.description || ''}</p>
                </div>
                <div id="qrcode-box"></div>
            </div>
            ${isWarning ? `
                <div class="hazard-container">
                    <h3 style="margin-bottom: 12px; font-size: 1rem;">職業安全衛生：五大危害控制措施</h3>
                    ${hazards.map((h, i) => `
                        <div class="hazard-card">
                            <div class="hazard-content"><strong>控制 ${i+1}:</strong> <span id="hazard-text-${i}">${h || '無資料'}</span></div>
                            <button onclick="app.handleHazardAction(${i}, '${container.id}')">${this.isAdmin ? '編輯' : '新增'}</button>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;

        // 產生獨立的 QR Code 連結至此第三層
        new QRCode(document.getElementById("qrcode-box"), {
            text: currentUrl,
            width: 80,
            height: 80
        });
    }

    // 搜尋防抖機制（300ms）與局部容器列表更新（不閃頻）
    handleSearchInput(event) {
        clearTimeout(this.searchTimer);
        const keyword = event.target.value.toLowerCase();

        this.searchTimer = setTimeout(() => {
            const grid = document.getElementById('category-grid');
            const filtered = this.data.containers.filter(c => 
                c.name.toLowerCase().includes(keyword) || c.category.toLowerCase().includes(keyword)
            );

            // 僅局部更新圖片與容器呈現，頂部標題與搜尋框完全不動
            grid.innerHTML = filtered.map(c => `
                <div class="card" onclick="app.navigateToDetail('${c.id}')">
                    <img src="${c.iconUrl}" alt="${c.name}">
                    <h3>${c.name}</h3>
                </div>
            `).join('');
        }, 300);
    }

    updatePendingBadge() {
        const count = this.data.pendingApprovals.length;
        const badge = document.getElementById('pending-badge');
        if (count > 0) {
            badge.innerText = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    goBack() {
        window.history.back();
    }

    goHome() {
        window.location.hash = "#/";
    }

    // 簡易 IndexedDB 本地快取封裝
    async saveToCache(data) {
        localStorage.setItem('cached_system_data', JSON.stringify(data));
    }

    // 開啟管理員登入或控制中心彈窗
    openAdminModal() {
        const modal = document.getElementById('admin-modal');
        const body = document.getElementById('admin-modal-body');
        modal.style.display = 'flex';

        if (!this.isAdmin) {
            body.innerHTML = `
                <h3 style="margin-bottom: 16px;">管理員登入控制中心</h3>
                <div class="admin-form-group">
                    <label>請輸入管理員密碼：</label>
                    <input type="password" id="admin-pwd-input" placeholder="預設密碼 admin123">
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                    <button onclick="app.closeModal()">取消</button>
                    <button class="primary" onclick="app.submitAdminLogin()">登入</button>
                </div>
            `;
        } else {
            this.renderAdminDashboard(body);
        }
    }

    closeModal() {
        document.getElementById('admin-modal').style.display = 'none';
    }

    async submitAdminLogin() {
        const pwd = document.getElementById('admin-pwd-input').value;
        try {
            const res = await fetch(GAS_API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: "adminLogin", password: pwd })
            });
            const json = await res.json();
            if (json.status === "success") {
                this.isAdmin = true;
                alert("管理員登入成功！");
                this.openAdminModal(); // 刷新彈窗顯示控制中心
                this.handleRoute();; // 重新渲染以更新按鈕文字（新增 -> 編輯）
            } else {
                alert(json.message || "密碼錯誤");
            }
        } catch (err) {
            alert("登入連線失敗：" + err);
        }
    }

    // 渲染管理員控制中心（含待審批清單與修改密碼）
    renderAdminDashboard(containerEl) {
        const approvals = this.data.pendingApprovals;
        containerEl.innerHTML = `
            <h3 style="margin-bottom: 16px;">管理員控制中心</h3>
            
            <div style="margin-bottom: 20px;">
                <h4 style="font-size: 0.95rem; margin-bottom: 8px; color: #ef4444;">待審批清單 (${approvals.length})</h4>
                <div style="max-height: 200px; overflow-y: auto;">
                    ${approvals.length === 0 ? '<p style="font-size: 0.85rem; color: #64748b;">目前沒有待審批的項目</p>' : 
                        approvals.map(item => `
                            <div class="approval-item">
                                <div style="font-size: 0.85rem;">
                                    <strong>容器:</strong> ${item.containerId}<br>
                                    <strong>提出內容:</strong> ${item.proposedContent}
                                </div>
                                <div>
                                    <button onclick="app.processApproval('${item.id}', 'Approve')" class="primary" style="padding: 4px 8px; font-size: 0.8rem;">核准</button>
                                    <button onclick="app.processApproval('${item.id}', 'Reject')" style="padding: 4px 8px; font-size: 0.8rem;">拒絕</button>
                                </div>
                            </div>
                        `).join('')}
                </div>
            </div>

            <div style="border-top: 1px solid var(--border); padding-top: 16px;">
                <h4 style="font-size: 0.95rem; margin-bottom: 8px;">更改管理員密碼</h4>
                <div class="admin-form-group">
                    <label>原密碼：</label>
                    <input type="password" id="old-pwd">
                </div>
                <div class="admin-form-group">
                    <label>新密碼：</label>
                    <input type="password" id="new-pwd">
                </div>
                <button class="primary" onclick="app.changePassword()">確認更改密碼</button>
            </div>

            <div style="display: flex; justify-content: space-between; margin-top: 20px;">
                <button onclick="app.isAdmin = false; app.closeModal(); app.handleRoute();">登出管理員</button>
                <button onclick="app.closeModal()">關閉視窗</button>
            </div>
        `;
    }

    async processApproval(approvalId, decision) {
        try {
            const res = await fetch(GAS_API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: "processApproval", approvalId: approvalId, decision: decision, operator: "Admin" })
            });
            const json = await res.json();
            if (json.status === "success") {
                alert(json.message);
                this.fetchLatestData(); // 重新取得最新資料與清單
                this.closeModal();
            } else {
                alert(json.message);
            }
        } catch (err) {
            alert("操作失敗：" + err);
        }
    }

    async changePassword() {
        const oldPassword = document.getElementById('old-pwd').value;
        const newPassword = document.getElementById('new-pwd').value;
        if (!oldPassword || !newPassword) {
            alert("請填寫完整密碼資訊");
            return;
        }

        try {
            const res = await fetch(GAS_API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: "changePassword", oldPassword, newPassword, operator: "Admin" })
            });
            const json = await res.json();
            if (json.status === "success") {
                alert(json.message);
                this.closeModal();
            } else {
                alert(json.message);
            }
        } catch (err) {
            alert("變更密碼失敗：" + err);
        }
    }

    // 處理 5 大危害控制措施的按鈕點擊（一般人送審批 / 管理員直接編輯）
    async handleHazardAction(hazardIndex, containerId) {
        const currentText = this.data.hazards[containerId]?.[hazardIndex] || "";
        
        if (this.isAdmin) {
            const newText = prompt(`管理員模式：編輯第 ${hazardIndex + 1} 項危害控制措施內容 (若有多項請以 ; 隔開)`, currentText);
            if (newText !== null) {
                let hazards = [...(this.data.hazards[containerId] || ["","","","",""])];
                hazards[hazardIndex] = newText;
                
                try {
                    const res = await fetch(GAS_API_URL, {
                        method: 'POST',
                        body: JSON.stringify({ action: "updateHazard", containerId, hazards, operator: "Admin" })
                    });
                    const json = await res.json();
                    if (json.status === "success") {
                        this.data.hazards[containerId] = hazards;
                        this.renderLayer3();
                        alert("更新成功");
                    }
                } catch (err) {
                    alert("更新失敗：" + err);
                }
            }
        } else {
            const proposed = prompt(`請輸入您想新增至第 ${hazardIndex + 1} 項危害控制措施的內容：`);
            if (proposed && proposed.trim() !== "") {
                try {
                    const res = await fetch(GAS_API_URL, {
                        method: 'POST',
                        body: JSON.stringify({ action: "submitApproval", containerId, hazardIndex: hazardIndex + 1, proposedContent: proposed })
                    });
                    const json = await res.json();
                    if (json.status === "success") {
                        alert(json.message);
                        this.fetchLatestData();
                    }
                } catch (err) {
                    alert("送出審批失敗：" + err);
                }
            }
        }
    }

    // 匯出所有標誌 PDF (利用前端列印機制結合 CSS 媒體查詢)
    exportAllPDF() {
        window.print();
    }

    // 匯出搜尋得到的標誌 PDF
    exportSearchPDF() {
        window.print();
    }

    async loadFromCache() {
        const cached = localStorage.getItem('cached_system_data');
        if (cached) {
            this.data = JSON.parse(cached);
            this.updatePendingBadge();
        }
    }
}

const app = new App();
