# BitCash / Midasbuy automation

Node.js + Playwright flow for the Japan Midasbuy pack **99 + 109 (146 JPY)**, wrapped in an Express API. The default API mode is a dry run. Real payment needs both `dryRun: false` and an explicit `confirm: "PAY 146"` request body.

## Install and configure

```powershell
npm install
npm run setup
Copy-Item .env.example .env
# Edit .env with private credentials; never commit it.
npm test
```

`npm test` uses a fake runner only: it opens no browser and never makes a payment.

## Run

```powershell
# Safe browser exploration: stops at the MyBitCash login form.
npm run dry-run

# Start HTTP API at http://localhost:3000
npm start
```

Use [requests.http](./requests.http) in VS Code REST Client, or import [postman/bitcash-bot.postman_collection.json](./postman/bitcash-bot.postman_collection.json). `POST /orders` starts a dry run unless `dryRun` is explicitly `false`. For a real order, send an `Idempotency-Key` and `confirm: "PAY 146"`. Once its status is `AWAITING_OTP`, HR can submit the six-digit code through `POST /orders/:id/otp`.

The API persists local order state to `data/orders.json` (ignored by Git). Screenshots and parsed completion data are placed under `artifacts/`.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| POST | `/orders` | Start a dry run or explicitly confirmed real order |
| GET | `/orders`, `/orders/:id` | List or inspect state and step log |
| POST | `/orders/:id/otp` | Supply six-digit OTP only while waiting |
| POST | `/orders/:id/resolve` | Resolve an uncertain post-OTP result manually |
| GET | `/balance` | Latest parsed balance plus reconciliation checks |

## Deliverable answers

### 1. วิธีทำงานและโครงสร้าง

Playwright ใช้ persistent Chrome context เพื่อรองรับ iframe ของ Midasbuy payment SDK และ popup/new tab ของ MyBitCash. Flow คือ Login → ตรวจ/เปลี่ยน UID → เลือก pack 99+109 → ยืนยันราคา 146 JPY → เลือก BitCash → เปิด MyBitCash. API แยก state ออกจาก browser flow และบันทึกทุก step, error, screenshot และผลสำเร็จไว้ใน order store. Credential อ่านจาก `.env` เท่านั้น และ `.env.example` ใช้ placeholder ไม่มีรหัสจริง.

### 2. ปัญหาที่พบจากการสำรวจ และวิธีรับมือ

- Login อยู่ใน iframe URL ที่มี `/apps/login`; payment dialog อยู่ใน iframe `payment-sdk`; MyBitCash เปิดเป็น popup. โค้ดจึงหา frame และรอ popup โดยตรง แทนการใช้ selector บนหน้าแม่.
- มี passkey popup และ cookie banner ที่บัง click ได้ จึงมีขั้น dismiss ก่อนตรวจ UID.
- MyBitCash มี reCAPTCHA/App Check; โค้ดตรวจ frame reCAPTCHA และจะหยุดให้คนดำเนินการเอง ไม่พยายาม bypass.
- Selector หรือ UI เปลี่ยน, UID ไม่ตรง, ราคาไม่ใช่ 146, purchase limit เต็ม, session/OTP หมดอายุ และ login ล้มเหลว ถูกบันทึกด้วย error code และ screenshot. `MANUAL_ASSIST=true` ให้คนช่วยเฉพาะขั้นที่ปลอดภัย.
- หลังเริ่มส่ง OTP แล้วห้าม auto-retry: ถ้าผลลัพธ์ขาดหายจะเป็น `UNKNOWN_CHECK_MANUALLY` และต้องตรวจ Order Center/resolve ก่อนเริ่มรายการจริงใหม่.

### 3. ระบบเช็กยอด

หน้าสำเร็จจะ parse `Invoice No.`, ยอดชำระ, ยอดคงเหลือ, `Transaction No.` และเวลา พร้อม screenshot/JSON. `GET /balance` ตรวจว่า paid amount เท่ากับ 146 และเมื่อมี reading ก่อนหน้า จะตรวจ `ยอดก่อนหน้า - ยอดจ่าย = ยอดคงเหลือใหม่`. ค่าไม่สอดคล้องจะคืน `consistent: false` เพื่อให้ตรวจสอบด้วยมือ. สำหรับ production ควรเพิ่ม scheduled login/read-balance แล้วเก็บข้อมูลใน SQLite/Postgres เพื่อ reconciliation ซ้ำภายหลัง.

## Safety notes

มี idempotency key, อนุญาต browser session เดียว, จำกัดหนึ่งรายการจริงที่สำเร็จ และต้องยืนยันข้อความราคาให้ตรงก่อนเริ่มจริง. `npm run dry-run` ไม่กรอก BitCash credential และไม่รอ OTP. การทดสอบ OTP/ชำระเงินจริงให้ HR เป็นผู้ดำเนินการตามเวลาที่กำหนด.
