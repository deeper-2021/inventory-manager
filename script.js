new Vue({
    el: '#app',
    data: {
        activeTab: 'manager',
        gasUrl: '',
        manualLocationId: '',
        scannedLocation: null,
        inventory: [],
        loadingInventory: false,
        
        productId: '',
        productName: '',
        products: [],
        quantity: 1,
        
        targetLocationInput: false,
        targetLocationId: '',
        
        locationToGenerate: '',
        productIdToGenerate: "",
        productNameToGenerate: "",
        barcodeGenerated: false,
        generatedBarcodeTitle: '',
        
        html5QrCodeLocation: null,
        html5QrCodeProduct: null,
        isScanningLocation: false,
        scannerTarget: 'inventory',
        
        showModal: false,
        modalTitle: '',
        modalMessage: '',
        modalType: 'success', 
        modalMode: 'notification', 
        pendingAction: null,
        
        showProductScannerModal: false,
        productSearchResults: [],
        
        loadingTotalStock: false,
        totalStockResult: null,
    },
    methods: {
        formatProductName(product) {
            if (!product) return '';
            return `${product.ProductName || ''} ${product.ProductOption1 || ''} ${product.ProductOption2 || ''}`.trim();
        },
        searchProducts() {
            const searchTerm = this.productName.trim().toLowerCase();
            if (searchTerm === '') {
                this.productSearchResults = [];
                return;
            }
            const searchKeywords = searchTerm.split(' ').filter(k => k);
            this.productSearchResults = this.products.filter(p => {
                const fullName = this.formatProductName(p).toLowerCase();
                return searchKeywords.every(keyword => fullName.includes(keyword));
            });
        },
        selectSearchedProduct(product) {
            this.productId = product.ProductID;
            this.productName = this.formatProductName(product);
            this.productSearchResults = []; 
        },
        selectProduct(item) {
            this.productId = item.ProductID;
            this.productName = this.formatProductName(item);
            this.quantity = 1; 
        },
        
        // --- API Call ---
        async callGasApi(payload) {
            if (!this.gasUrl) {
                this.showNotification('설정 필요', '설정 탭에서 GAS URL을 먼저 등록해주세요.', 'error');
                return null;
            }
            try {
                const response = await fetch(this.gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload),
                });
                const data = await response.json(); 
                if (data.status === 'error') throw new Error(data.message);
                return data;
            } catch (error) {
                this.showNotification('API 오류', error.message, 'error');
                return null;
            }
        },

        async fetchProducts() {
            const data = await this.callGasApi({ action: 'getProducts' });
            if (data && data.data) this.products = data.data;
        },

        // --- Inventory Management ---
        fetchInventoryByManualInput() {
            if (!this.manualLocationId) return this.showNotification('오류', '위치 ID를 입력하세요.', 'error');
            this.fetchInventory(this.manualLocationId.trim());
        },
        async fetchInventory(locationId) {
            this.loadingInventory = true;
            this.scannedLocation = locationId;
            const data = await this.callGasApi({ action: 'getInventory', location: locationId });
            if (data) this.inventory = data.data;
            this.loadingInventory = false;
        },
        
        async fetchTotalStock() {
            this.loadingTotalStock = true;
            const data = await this.callGasApi({ action: 'getTotalStock', productId: this.productId });
            if (data) this.totalStockResult = data.data;
            this.loadingTotalStock = false;
        },

        // --- IN / OUT / MOVE Actions ---
        confirmUpdateStock(type) {
            if (!this.productId || !this.quantity) return this.showNotification('오류', '제품을 선택하고 수량을 입력하세요.', 'error');
            const typeText = type === 'IN' ? '입고' : '출고';
            
            this.modalMode = 'confirmation';
            this.modalTitle = `${typeText} 확인`;
            this.modalMessage = `[${this.productName}] ${this.quantity}개를 ${typeText}하시겠습니까?`;
            this.pendingAction = () => this.updateStock(type);
            this.showModal = true;
        },
        async updateStock(type) {
            const prod = this.products.find(p => p.ProductID == this.productId);
            if (!prod) return this.showNotification('오류', '제품 마스터에 없는 제품입니다.', 'error');

            this.modalMode = 'loading'; this.modalTitle = '처리 중';
            const data = await this.callGasApi({
                action: 'updateStock', location: this.scannedLocation,
                productId: prod.ProductID, productName: prod.ProductName,
                productOption1: prod.ProductOption1, productOption2: prod.ProductOption2,
                quantity: this.quantity, type: type
            });
            if (data) {
                this.showNotification('완료', data.message, 'success');
                this.fetchInventory(this.scannedLocation);
            } else this.closeModal();
        },

        confirmMoveStock() {
            if (!this.targetLocationId) return this.showNotification('오류', '도착지 위치 ID를 입력하세요.', 'error');
            if (this.targetLocationId === this.scannedLocation) return this.showNotification('오류', '현재 위치와 도착지가 같습니다.', 'error');
            
            this.modalMode = 'confirmation';
            this.modalTitle = `재고 이동 확인`;
            this.modalMessage = `[${this.productName}] ${this.quantity}개를\n${this.scannedLocation} -> ${this.targetLocationId} (으)로 이동하시겠습니까?`;
            this.pendingAction = () => this.moveStock();
            this.showModal = true;
        },
        async moveStock() {
            const prod = this.products.find(p => p.ProductID == this.productId);
            this.modalMode = 'loading'; this.modalTitle = '이동 처리 중';
            
            const data = await this.callGasApi({
                action: 'moveStock', 
                sourceLocation: this.scannedLocation, targetLocation: this.targetLocationId,
                productId: prod.ProductID, productName: prod.ProductName,
                productOption1: prod.ProductOption1, productOption2: prod.ProductOption2,
                quantity: this.quantity
            });
            if (data) {
                this.showNotification('이동 완료', data.message, 'success');
                this.targetLocationInput = false;
                this.targetLocationId = '';
                this.fetchInventory(this.scannedLocation);
            } else this.closeModal();
        },

        confirmRemoveStockItem(item) {
            this.modalMode = 'confirmation'; this.modalType = 'error';
            this.modalTitle = '항목 삭제';
            this.modalMessage = `해당 위치에서 [${item.ProductName}] 기록을 완전히 삭제하시겠습니까?`;
            this.pendingAction = () => this.removeStockItem(item);
            this.showModal = true;
        },
        async removeStockItem(item) {
            this.modalMode = 'loading';
            const data = await this.callGasApi({
                action: 'removeStockItem', location: item.LocationID,
                productId: item.ProductID, productOption1: item.ProductOption1, productOption2: item.ProductOption2
            });
            if (data) {
                this.showNotification('삭제 완료', data.message, 'success');
                this.fetchInventory(this.scannedLocation);
            }
        },

        // --- Scanner Logic ---
        toggleLocationScan() {
            if (this.isScanningLocation) {
                this.html5QrCodeLocation.stop().then(() => this.isScanningLocation = false);
            } else {
                if (!this.html5QrCodeLocation) this.html5QrCodeLocation = new Html5Qrcode("reader");
                this.isScanningLocation = true;
                this.html5QrCodeLocation.start(
                    { facingMode: "environment" }, { fps: 10, qrbox: 250 },
                    (decodedText) => {
                        this.manualLocationId = decodedText;
                        this.fetchInventory(decodedText);
                        this.toggleLocationScan();
                    },
                    (err) => {}
                ).catch(() => { this.isScanningLocation = false; this.showNotification('오류', '카메라 권한을 확인하세요.', 'error'); });
            }
        },

        showProductScanner() { this.scannerTarget = 'inventory'; this.startProductScan(); },
        showProductScannerForTotalStock() { this.scannerTarget = 'totalStock'; this.startProductScan(); },
        
        startProductScan() {
            this.showProductScannerModal = true;
            this.$nextTick(() => {
                this.html5QrCodeProduct = new Html5Qrcode("product-reader");
                this.html5QrCodeProduct.start(
                    { facingMode: "environment" }, { fps: 10, qrbox: 250 },
                    (decodedText) => {
                        let id = decodedText, name = '';
                        if(decodedText.includes('|')) {
                            [id, name] = decodedText.split('|');
                        }
                        this.productId = id;
                        if(name) this.productName = name;
                        else {
                            const p = this.products.find(x => x.ProductID == id);
                            if(p) this.productName = this.formatProductName(p);
                        }
                        
                        if(this.scannerTarget === 'totalStock') this.fetchTotalStock();
                        this.closeProductScanner();
                    },
                    (err) => {}
                );
            });
        },
        closeProductScanner() {
            if (this.html5QrCodeProduct && this.html5QrCodeProduct.isScanning) {
                this.html5QrCodeProduct.stop().then(() => this.showProductScannerModal = false);
            } else {
                this.showProductScannerModal = false;
            }
        },

        // --- Barcode Generator ---
        generateBarcode(type) {
            let data = type === 'location' ? this.locationToGenerate : `${this.productIdToGenerate}|${this.productNameToGenerate}`;
            if (!data || data === '|') return this.showNotification('오류', '값을 입력해주세요.', 'error');
            
            this.generatedBarcodeTitle = type === 'location' ? `로케이션: ${data}` : `제품: ${this.productNameToGenerate}`;
            this.barcodeGenerated = true;
            this.$nextTick(() => { JsBarcode("#barcode", data, { format: "CODE128", displayValue: true }); });
        },
        printBarcode() {
            const svg = document.getElementById('barcode').outerHTML;
            const win = window.open('', '_blank');
            win.document.write(`<body style="text-align:center;margin-top:50px;">${svg}<script>window.onload=()=>{window.print();window.close();}<\/script></body>`);
            win.document.close();
        },

        // --- Modal & Settings ---
        saveSettings() {
            localStorage.setItem('inventoryGasUrl', this.gasUrl);
            this.showNotification('저장 완료', '설정이 저장되었습니다.', 'success');
        },
        showNotification(title, message, type='success') {
            this.modalMode = 'notification'; this.modalTitle = title;
            this.modalMessage = message; this.modalType = type;
            this.showModal = true;
        },
        closeModal() {
            this.showModal = false; this.pendingAction = null; this.modalMode = 'notification';
        },
        executePendingAction() {
            if (typeof this.pendingAction === 'function') this.pendingAction();
        }
    },
    mounted() {
        this.gasUrl = localStorage.getItem('inventoryGasUrl') || '';
        this.fetchProducts();
    }
});
