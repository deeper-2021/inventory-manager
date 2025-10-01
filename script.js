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
        pendingAction: null, // Stores the function to execute after confirmation
    },
    methods: {
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

        // --- Core Application Logic ---
        async updateStock(type) {
            const payload = {
                action: 'updateStock',
                location: this.scannedLocation,
                productId: this.productId.trim(),
                productName: this.productName.trim(),
                quantity: this.quantity,
                type: type
            };
            
            const data = await this.callGasApi(payload);

            if (data) {
                this.showNotification(
                    `${type === 'IN' ? '입고' : '출고'} 완료`,
                    data.message || `[${this.productName}] 처리가 완료되었습니다.`, // Use message from server
                    'success'
                );
                // Clear form and refresh inventory
                this.productId = '';
                this.productName = '';
                this.quantity = 1;
                this.fetchInventory(this.scannedLocation);
            }
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
            this.productName = item.ProductName;
            // 수량은 1로 초기화하여 사용자가 새로 입력하도록 유도
            this.quantity = 1; 
        },

        // --- Core Application Logic ---
        // ★ 변경: 로딩 모달 표시/숨김 로직 추가
        async updateStock(type) {
            // 1. 모달 내용을 '로딩' 상태로 즉시 변경
            this.modalMode = 'loading';
            this.modalType = 'loading';
            this.modalTitle = '재고 처리 중';
            this.modalMessage = '서버와 통신 중입니다. 잠시만 기다려주세요...';

            const payload = {
                action: 'updateStock',
                location: this.scannedLocation,
                productId: this.productId.trim(),
                productName: this.productName.trim(),
                quantity: this.quantity,
                type: type
            };
            
            // 2. API 호출 (성공/실패 시 callGasApi 내부 또는 아래에서 모달 내용을 바꿈)
            const data = await this.callGasApi(payload);

            // 3. 성공 시, 로딩 모달 내용을 '성공' 알림으로 변경
            if (data) {
                this.showNotification(
                    `${type === 'IN' ? '입고' : '출고'} 완료`,
                    data.message || `[${this.productName}] 처리가 완료되었습니다.`,
                    'success'
                );
                this.productId = '';
                this.productName = '';
                this.quantity = 1;
                this.fetchInventory(this.scannedLocation);
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
        startScan() {
            if (window.location.protocol !== "https:") {
                this.showNotification('보안 오류', '카메라를 사용하려면 HTTPS 연결이 필요합니다.', 'error');
                return;
            }
            this.isScanning = true;
            this.html5QrCode.start(
                { facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } },
                this.onScanSuccess, () => {}
            ).catch(err => {
                this.isScanning = false;
                this.showNotification('스캔 오류', `카메라를 시작할 수 없습니다. 권한을 확인해주세요. (${err})`, 'error');
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
        generateBarcode() { /* ... previous code ... */ },
        printBarcode() { /* ... previous code ... */ },

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
    },
    watch: {
        activeTab(newTab, oldTab) {
            if (newTab !== 'manager' && this.isScanning) {
                this.stopScan();
            }
        }
    }
});

