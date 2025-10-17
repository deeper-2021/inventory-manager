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
        locationToGenerate: '',
        barcodeGenerated: false,
        html5QrCode: null,
        isScanning: false,
        // --- Modal State ---
        showModal: false,
        modalTitle: '',
        modalMessage: '',
        modalType: 'success', // 'success', 'error', or 'confirmation'
        modalMode: 'notification', // 'notification' or 'confirmation'
        showProductScannerModal: false,
        productSearchResults: [],
        productIdToGenerate: "",
        productNameToGenerate: "",
        productIdForTotalStock: "",
        loadingTotalStock: false,
        totalStockResult: false,
        pendingAction: null, // Stores the function to execute after confirmation
    },
    methods: {
        searchProducts() {
            const searchTerm = this.productName.trim().toLowerCase();
            if (searchTerm === '') {
                this.productSearchResults = [];
                return;
            }
            
            // 검색어를 공백 기준으로 나눠서 배열로 만듭니다. (예: "소총 우드" -> ["소총", "우드"])
            const searchKeywords = searchTerm.split(' ').filter(k => k);

            this.productSearchResults = this.products.filter(p => {
                const fullName = `${p.ProductName} ${p.ProductOption1 || ''} ${p.ProductOption2 || ''}`.toLowerCase();
                
                // 모든 검색 키워드가 제품명에 포함되어 있는지 확인합니다.
                return searchKeywords.every(keyword => fullName.includes(keyword));
            });
        },
        selectSearchedProduct(product) {
            this.productId = product.ProductID;
            // 옵션을 포함한 전체 이름으로 설정
            this.productName = this.formatProductName(product);
            this.productSearchResults = []; // 검색 목록 숨기기
        },

        // onProductScanSuccess에서 제품명 자동 완성을 위해 수정
        onProductScanSuccess(decodedText) {
            let scannedProductId = decodedText;
            let scannedProductName = '';

            if (decodedText.includes('|')) {
                const parts = decodedText.split('|');
                scannedProductId = parts[0];
                scannedProductName = parts[1];
            }

            if (this.scannerTarget === 'totalStock') {
                this.productIdForTotalStock = scannedProductId;
                this.fetchTotalStock();
            } else { 
                this.productId = scannedProductId;
                // 스캔된 이름이 있으면 사용, 없으면 products 목록에서 찾기
                if (scannedProductName) {
                        this.productName = scannedProductName;
                } else {
                    const foundProduct = this.products.find(p => p.ProductID == this.productId);
                    if (foundProduct) {
                        this.productName = `${foundProduct.ProductName} ${foundProduct.ProductOption1 || ''} ${foundProduct.ProductOption2 || ''}`.trim();
                    } else {
                        this.productName = ''; // 못 찾으면 비워두기
                    }
                }
            }
            this.closeProductScanner();
        },

        async fetchTotalStock() {
            this.loadingTotalStock = true;
            this.totalStockResult = null;

            const payload = {
                action: 'getTotalStock',
                productId: this.productId,
            };

            const data = await this.callGasApi(payload);
            if (data) {
                this.totalStockResult = data.data;
            }
            this.loadingTotalStock = false;
        },

        async fetchProducts() {
            const payload = {
                action: 'getProducts',
            };
            
            const data = await this.callGasApi(payload);

            if (data && data.data) {
                this.products = data.data;
                console.log("제품 목록 저장 완료:", this.products); 
            }
        },

        // ★ 추가: 재고 항목 삭제 관련 메소드
        confirmRemoveStockItem(item) {
            this.modalMode = 'confirmation';
            this.modalType = 'error'; // 삭제는 위험한 작업이므로 빨간색으로 강조
            this.modalTitle = '재고 항목 삭제 확인';
            this.modalMessage = `정말로 위치 [${item.LocationID}]에서 제품 [${item.ProductName}]의 모든 재고 기록을 완전히 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`;
            
            this.pendingAction = () => this.removeStockItem(item);
            
            this.showModal = true;
        },

        // ★ 수정: removeStockItem의 payload 변경
        async removeStockItem(item) {
            this.modalMode = 'loading';
            this.modalType = 'loading';
            this.modalTitle = '재고 삭제 중';
            this.modalMessage = `[${this.formatProductName(item)}] 항목을 삭제하고 있습니다...`;

            const payload = {
                action: 'removeStockItem',
                location: item.LocationID,
                productId: item.ProductID,
                productOption1: item.ProductOption1,
                productOption2: item.ProductOption2,
            };
            
            const data = await this.callGasApi(payload);
            if (data) {
                this.showNotification('삭제 완료', data.message, 'success');
                this.fetchInventory(this.scannedLocation);
            }
        },

        // ★ 추가: 제품 이름 포맷팅 헬퍼 함수
        formatProductName(product) {
            if (!product) return '';
            return `${product.ProductName || ''} ${product.ProductOption1 || ''} ${product.ProductOption2 || ''}`.trim();
        },
        // --- Central API Call Function ---
        async callGasApi(payload) {
            if (!this.gasUrl) {
                this.showNotification('설정 필요', '먼저 설정 탭에서 Google Apps Script URL을 입력해주세요.', 'error');
                return null;
            }
            try {
                const response = await fetch(this.gasUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload),
                });
                // It's important that your GAS script returns a proper JSON response
                // and does not do a 302 redirect.
                const data = await response.json(); 
                if (data.status === 'error') {
                    throw new Error(data.message);
                }
                return data;
            } catch (error) {
                this.showNotification('API 오류', `서버와 통신 중 오류가 발생했습니다: ${error.message}`, 'error');
                return null;
            }
        },

        // --- Product Scanner Methods ---
        showProductScanner() {
            this.scannerTarget = 'inventory'; // 스캐너 타겟 설정
            this.showProductScannerModal = true;
            this.$nextTick(() => { this.initializeAndStartProductScanner(); });
        },

        // ★ 추가: 총 재고 조회를 위한 스캐너 호출
        showProductScannerForTotalStock() {
            this.scannerTarget = 'totalStock'; // 스캐너 타겟 설정
            this.showProductScannerModal = true;
            this.$nextTick(() => { this.initializeAndStartProductScanner(); });
        },

        // ★ 수정: 제품 스캐너 시작/종료 로직 개선
        startProductScan() {
            try {
                // 모달이 열릴 때마다 항상 새 인스턴스 생성
                this.productScanner = new Html5Qrcode("product-reader");
                this.productScanner.start(
                    { facingMode: "environment" }, 
                    { fps: 10, qrbox: { width: 250, height: 250 } }, 
                    (decodedText) => { this.onProductScanSuccess(decodedText); },
                    (err) => { /* Ignore scan failures */ }
                ).catch(err => { 
                    this.showNotification('스캔 오류', '제품 스캐너 카메라를 시작할 수 없습니다. 권한을 확인해주세요.', 'error'); 
                    this.closeProductScanner();
                });
            } catch (e) {
                this.showNotification('오류', '제품 스캐너 영역(#product-reader)을 찾을 수 없습니다.', 'error');
                this.showProductScannerModal = false;
            }
        },

        onProductScanSuccess(decodedText) {
            // 구분 기호 '|' 가 있는지 확인
            if (decodedText.includes('|')) {
                const parts = decodedText.split('|');
                this.productId = parts[0];
                this.productName = parts[1];
            } else {
                // 구분 기호가 없으면 기존 방식대로 ID만 채움 (하위 호환성)
                this.productId = decodedText;
                this.productName = ''; // 제품명은 비워둠
            }
            this.closeProductScanner();
        },

        closeProductScanner() {
            if (this.productScanner && this.productScanner.isScanning) {
                this.productScanner.stop()
                    .then(ignore => {
                        this.showProductScannerModal = false;
                    })
                    .catch(err => {
                        console.error("제품 스캐너를 중지하는데 실패했습니다.", err);
                        this.showProductScannerModal = false; // Force close modal
                    });
            } else {
                this.showProductScannerModal = false;
            }
        },



        // --- Modal and Confirmation Logic ---
        confirmUpdateStock(type) {
            if (!this.productId || !this.productName || !this.quantity) {
                this.showNotification('입력 오류', '제품 ID, 제품명, 수량을 모두 입력해주세요.', 'error');
                return;
            }
            if (this.quantity <= 0) {
                 this.showNotification('입력 오류', '수량은 1 이상이어야 합니다.', 'error');
                return;
            }
            
            const typeText = type === 'IN' ? '입고' : '출고';
            this.modalMode = 'confirmation';
            this.modalType = 'confirmation';
            this.modalTitle = `재고 ${typeText} 확인`;
            this.modalMessage = `정말로 [${this.productName}] ${this.quantity}개를 ${typeText}하시겠습니까?`;
            
            // Store the action to be executed if the user confirms
            this.pendingAction = () => this.updateStock(type);
            
            this.showModal = true;
        },
        
        executePendingAction() {
            if (typeof this.pendingAction === 'function') {
                this.pendingAction();
            }
            this.closeModal();
        },

        closeModal() {
            this.showModal = false;
            // Reset modal state for the next use
            this.pendingAction = null;
            this.modalMode = 'notification';
        },

        // ★ 변경: 모달을 닫지 않고, 저장된 액션(updateStock)만 실행
        executePendingAction() {
            if (typeof this.pendingAction === 'function') {
                this.pendingAction(); // updateStock이 호출되며, 이 함수가 모달 상태를 'loading'으로 바꿀 것임
            }
        },

        closeModal() {
            this.showModal = false;
            this.pendingAction = null;
            this.modalMode = 'notification';
        },

        selectProduct(item) {
            this.productId = item.ProductID;
            this.productName = this.formatProductName(item);
            this.quantity = 1; 
        },

        async updateStock(type) {
            // productId로부터 제품 전체 정보 다시 찾기 (정확한 데이터 전송을 위해)
            const productInfo = this.products.find(p => p.ProductID == this.productId);
            if (!productInfo) {
                this.showNotification('오류', '제품 목록에 없는 제품 ID입니다. 먼저 제품을 등록해주세요.', 'error');
                return;
            }

            this.modalMode = 'loading'; this.modalType = 'loading'; this.modalTitle = '재고 처리 중'; this.modalMessage = '서버와 통신 중입니다...';

            const payload = {
                action: 'updateStock',
                location: this.scannedLocation,
                productId: productInfo.ProductID,
                productName: productInfo.ProductName, // 기본 이름
                productOption1: productInfo.ProductOption1,
                productOption2: productInfo.ProductOption2,
                quantity: this.quantity,
                type: type
            };
            
            const data = await this.callGasApi(payload);
            if (data) {
                this.showNotification(`${type === 'IN' ? '입고' : '출고'} 완료`, data.message, 'success');
                this.productId = ''; this.productName = ''; this.quantity = 1;
                this.fetchInventory(this.scannedLocation);
            } else {
                this.closeModal();
            }
        },


        fetchInventoryByManualInput() {
            if (!this.manualLocationId) {
                this.showNotification('오류', '조회할 위치 ID를 입력해주세요.', 'error');
                return;
            }
            this.fetchInventory(this.manualLocationId.trim());
        },

        async fetchInventory(locationId) {
            this.loadingInventory = true;
            this.inventory = [];
            this.scannedLocation = locationId;

            const data = await this.callGasApi({
                action: 'getInventory',
                location: locationId
            });

            if (data) {
                this.inventory = data.data;
            }
            this.loadingInventory = false;
        },

        // --- Settings Management ---
        saveSettings() {
            if (!this.gasUrl || !this.gasUrl.startsWith('https://script.google.com/macros/')) {
                this.showNotification('오류', '유효한 Google Apps Script URL을 입력해주세요.', 'error');
                return;
            }
            localStorage.setItem('inventoryGasUrl', this.gasUrl);
            this.showNotification('저장 완료', '설정이 성공적으로 저장되었습니다.', 'success');
        },
        loadSettings() {
            const savedUrl = localStorage.getItem('inventoryGasUrl');
            if (savedUrl) {
                this.gasUrl = savedUrl;
            }
        },

        // --- Barcode Scanning ---
        initializeScanner() {
            this.html5QrCode = new Html5Qrcode("reader");
        },
        toggleScan() {
            if (this.isScanning) {
                this.stopScan();
            } else {
                this.startScan();
            }
        },
       // ★ 변경: 스캐너를 시작할 때 초기화하도록 로직 변경
        startScan() { 
            // 스캐너 인스턴스가 없으면 새로 생성
            if (!this.html5QrCode) {
                try {
                    this.html5QrCode = new Html5Qrcode("reader");
                } catch(e) {
                    this.showNotification('오류', '위치 스캐너 영역(#reader)을 찾을 수 없습니다.', 'error');
                    return;
                }
            }
            
            this.isScanning = true; 
            this.html5QrCode.start(
                { facingMode: "environment" }, 
                { fps: 10, qrbox: { width: 250, height: 250 } }, 
                (decodedText, decodedResult) => {
                    this.onScanSuccess(decodedText, decodedResult);
                },
                (err) => { /* Ignore scan failures */ }
            ).catch(err => { 
                this.isScanning = false; 
                this.showNotification('스캔 오류', '카메라를 시작할 수 없습니다. 권한을 확인해주세요.', 'error'); 
            }); 
        },
        stopScan() {
            if (this.isScanning && this.html5QrCode.isScanning) {
                this.html5QrCode.stop().then(() => { this.isScanning = false; }).catch(err => { this.isScanning = false; });
            }
        },
        onScanSuccess(decodedText, decodedResult) {
            this.manualLocationId = decodedText;
            this.fetchInventory(decodedText);
            this.stopScan();
        },

        // --- Barcode Generation ---
        generateBarcode(type) {
            let dataToEncode = '';
            if (type === 'location') {
                if (!this.locationToGenerate) {
                    this.showNotification('입력 오류', '위치 ID를 입력해주세요.', 'error');
                    return;
                }
                dataToEncode = this.locationToGenerate;
                this.generatedBarcodeTitle = `위치: ${dataToEncode}`;
            } else if (type === 'product') {
                if (!this.productIdToGenerate || !this.productNameToGenerate) {
                    this.showNotification('입력 오류', '제품 ID와 제품명을 모두 입력해주세요.', 'error');
                    return;
                }
                // ID와 이름을 '|' 기호로 합침
                dataToEncode = `${this.productIdToGenerate}|${this.productNameToGenerate}`;
                this.generatedBarcodeTitle = `제품: ${this.productNameToGenerate}`;
            }

            this.barcodeGenerated = true;
            this.$nextTick(() => {
                JsBarcode("#barcode", dataToEncode, {
                    format: "CODE128",
                    displayValue: true,
                    fontSize: 18,
                    textMargin: 5
                });
            });
        },
        printBarcode() {
            const barcodeSVG = document.getElementById('barcode').outerHTML;
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <html>
                    <head><title>Print Barcode</title></head>
                    <body style="text-align:center; margin-top: 50px;">
                        ${barcodeSVG}
                        <script>
                            window.onload = function() {
                                window.print();
                                window.close();
                            }
                        <\/script>
                    </body>
                </html>
            `);
            printWindow.document.close();
        },

        // --- UI Helpers ---
        showNotification(title, message, type = 'success') {
            this.modalMode = 'notification'; // Ensure it's a notification
            this.modalTitle = title;
            this.modalMessage = message;
            this.modalType = type;
            this.showModal = true;
        }
    },
    mounted() {
        this.loadSettings();
        this.initializeScanner();
        this.fetchProducts(); 
    },
    watch: {
        activeTab(newTab, oldTab) {
            if (newTab !== 'manager' && this.isScanning) {
                this.stopScan();
            }
        }
    }
});

