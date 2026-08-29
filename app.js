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
        this.renderCurrentView();

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
                this.renderCurrentView();
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

    async loadFromCache() {
        const cached = localStorage.getItem('cached_system_data');
        if (cached) {
            this.data = JSON.parse(cached);
            this.updatePendingBadge();
        }
    }
}

const app = new App();
