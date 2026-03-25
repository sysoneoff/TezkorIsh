# TezkorIsh — Real Pilot v22

Bu build endi faqat frontend demo emas. Paket ichida:
- haqiqiy **Node.js server** (`server/server.js`)
- serverda saqlanadigan **persistent storage** (`server/data/db.json`)
- **Telegram website login callback** uchun backend verify skeleti
- session cookie asosidagi auth
- shared users/jobs/applications/contracts/chats/reviews/reports storage

## 1. Nima endi haqiqiy ishlaydi
- login session cookie orqali boshqariladi
- frontend global data uchun localStorage emas, server API ishlatadi
- jami user/jobs/chats/contracts serverda saqlanadi
- guest foydalanuvchi global data yozolmaydi
- Telegram callback serverda verify qilinmasdan profil yaratib bo'lmaydi
- demo `phone -> merge` olib tashlangan
- yangi user default rating `0`

## 2. Nima sizdan kerak
`server/.env.example` nusxasidan `.env` yarating va quyidagilarni kiriting:
- `APP_BASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `SESSION_SECRET`
- `ADMIN_TELEGRAM_IDS` (ixtiyoriy)

## 3. Ishga tushirish
```bash
cd server
node server.js
```

Server ishga tushgach ilova shu origin orqali ochiladi, masalan:
- `http://localhost:3000`
- yoki deploy bo'lsa `https://your-domain.com`

## 4. Telegram login qanday ulanadi
Frontend auth ekrani rasmiy Telegram widgetni ishlatadi.
Widget callback URL:
- `/api/auth/telegram/callback`

Server quyidagilarni qiladi:
1. Telegram query payloadni qabul qiladi
2. `hash` ni bot token bilan verify qiladi
3. session cookie yaratadi
4. mavjud user bo'lsa login qiladi
5. yangi user bo'lsa role/phone/name yakunlash oqimiga yuboradi

## 5. Muhim deploy qoidasi
Frontend va backendni **bir origin** da ishlatish tavsiya qilinadi.
Masalan:
- frontend: `https://tezkorish.example.com`
- backend ham shu serverda `/api/*`

Shunda:
- CORS muammosi bo'lmaydi
- cookie auth sodda ishlaydi
- sync storage API oqimi buzilmaydi

## 6. Hali siz qo'lda qilishingiz kerak bo'lganlar
- Telegram bot token va username kiritish
- public HTTPS serverga deploy
- Telegram callback URL ni BotFather/login sozlamalariga qo'shish
- real test userlar bilan auth sinash

## 7. Rost holat
Bu build **real pilot codebase**:
- auth bypasslar yopilgan
- data shared serverga ko'chirilgan
- lokal demo fallback public buildda o'chirilgan

Lekin men sizning bot token/domain/hosting access'laringizsiz uni live ulab bera olmayman.
Shuning uchun bu paket **deploy-ready codebase** bo'lib, live ishga tushirish uchun siz yoki hostingga kirish huquqi bo'lgan odam `.env` va deployni yakunlaydi.
