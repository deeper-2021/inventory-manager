

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
        showModal: false,
        modalTitle: '',
        modalMessage: '',
        modalType: 'success', // 'success' or 'error'
    },
    methods: {
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
            if (!this.html5QrCode) {
                 this.showNotification('오류', '스캐너를 초기화할 수 없습니다.', 'error');
                return;
            }
            this.isScanning = true;
            this.html5QrCode.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 }
                },
                this.onScanSuccess,
                this.onScanFailure
            ).catch(err => {
                this.isScanning = false;
                this.showNotification('스캔 오류', '카메라를 시작할 수 없습니다. 권한을 확인해주세요.', 'error');
            });
        },
        stopScan() {
            if (this.isScanning) {
                this.html5QrCode.stop().then(() => {
                    this.isScanning = false;
                }).catch(err => {
                    console.error("Scanner stop failed", err);
                    this.isScanning = false; // Force stop state
                });
            }
        },
        onScanSuccess(decodedText, decodedResult) {
            this.scannedLocation = decodedText;
            this.manualLocationId = decodedText;
            this.fetchInventory(decodedText);
            this.stopScan();
        },
        onScanFailure(error) {
            // This is called frequently, so we don't show notifications here.
            // console.warn(`Code scan error = ${error}`);
        },

        // --- Inventory Management ---
        fetchInventoryByManualInput() {
            if (!this.manualLocationId) {
                this.showNotification('오류', '조회할 위치 ID를 입력해주세요.', 'error');
                return;
            }
            this.scannedLocation = this.manualLocationId;
            this.fetchInventory(this.manualLocationId);
        },
        async fetchInventory(locationId) {
            console.log("?")
            if (!this.gasUrl) {
                this.showNotification('설정 필요', '먼저 설정 탭에서 Google Apps Script URL을 입력해주세요.', 'error');
                return;
            }
            this.loadingInventory = true;
            this.inventory = [];
            try {
                const response = await fetch(this.gasUrl, {
                    method: 'POST',
                    mode: 'no-cors', // Important for GAS web apps
                    headers: { 'Content-Type': 'text/plain;charset=utf-8', },
                    body: JSON.stringify({ action: 'getInventory', location: locationId })
                });
                // Since it's a no-cors request, we can't read the response directly.
                // We'll assume it worked and the actual data comes via a different mechanism if needed
                // For this simple case, we'll just redirect to see the result for debugging
                 const redirectResponse = await fetch(this.gasUrl + `?action=getInventory&location=${locationId}`);
                 const data = await redirectResponse.json();

                if (data.status === 'success') {
                    this.inventory = data.data;

                    console.log(data)
                } else {
                    throw new Error(data.message);
                }

            } catch (error) {
                this.showNotification('조회 오류', `재고 정보를 불러오는데 실패했습니다: ${error.message}`, 'error');
                this.inventory = []; // Clear inventory on error
            } finally {
                this.loadingInventory = false;
            }
        },
        async updateStock(type) {
            if (!this.productId || !this.productName || !this.quantity) {
                this.showNotification('입력 오류', '제품 ID, 제품명, 수량을 모두 입력해주세요.', 'error');
                return;
            }
            if (this.quantity <= 0) {
                 this.showNotification('입력 오류', '수량은 1 이상이어야 합니다.', 'error');
                return;
            }

            const payload = {
                action: 'updateStock',
                location: this.scannedLocation,
                productId: this.productId.trim(),
                productName: this.productName.trim(),
                quantity: this.quantity,
                type: type // 'IN' or 'OUT'
            };

            try {
                const response = await fetch(this.gasUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                     headers: { 'Content-Type': 'text/plain;charset=utf-8', },
                    body: JSON.stringify(payload)
                });
                
                // As above, we can't read response, so we optimistically update UI.
                this.showNotification(
                    `${type === 'IN' ? '입고' : '출고'} 완료`,
                    `[${this.productName}] ${this.quantity}개 처리가 완료되었습니다.`,
                    'success'
                );

                // Clear form and refresh inventory
                this.productId = '';
                this.productName = '';
                this.quantity = 1;
                this.fetchInventory(this.scannedLocation);

            } catch (error) {
                this.showNotification('업데이트 오류', `재고 업데이트 중 오류가 발생했습니다: ${error.message}`, 'error');
            }
        },

        // --- Barcode Generation ---
        generateBarcode() {
            if (!this.locationToGenerate) {
                this.showNotification('입력 오류', '바코드를 생성할 위치 ID를 입력해주세요.', 'error');
                return;
            }
            this.barcodeGenerated = true;
            this.$nextTick(() => {
                JsBarcode("#barcode", this.locationToGenerate, {
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
        showNotification(title, message, type) {
            this.modalTitle = title;
            this.modalMessage = message;
            this.modalType = type;
            this.showModal = true;
        }
    },
    mounted() {
        this.loadSettings();
        this.initializeScanner();
    }
});
