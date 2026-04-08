# TezkorIsh — Fixed Build v30

## Nimalar tuzatildi
- `Router.back()` xatosi tuzatildi. Endi orqaga qaytish `screens/showScreen` kabi yo‘q obyektlarga murojaat qilmaydi.
- Tashqi havolalar xavfsizlandi:
  - Telegram faqat `https://t.me` / `telegram.me`
  - Xarita faqat ishonchli `https` manzillar
  - Telefon/WhatsApp uchun telefon raqami normallashtirildi.
- `updateJob()` ichida e'lon muddati tahrirlash vaqtida qayta hisoblanadigan qilindi.
- Server pilot rejimida backup import o‘chirildi.
- Service worker yangilandi:
  - cache versiyasi `v30`
  - asosiy app shell fayllari pre-cache qilinadi.
- Remote write navbati foydalanuvchi autentifikatsiyasiz serverga yozishga urinmaydi.
- Server storage xavfsizligi kuchaytirildi:
  - oddiy user boshqa user ma'lumotini bosib yozolmaydi
  - global storage delete taqiqlandi
  - `tezkorish.user` yozuvi admin flagni soxtalashtirmaydi
  - jobs/applications/contracts/reviews/chats/reports/users uchun server-side merge va ruxsat tekshiruvi qo‘shildi.
- Derived metrics serverda qayta hisoblanadi:
  - `completedJobs`
  - `rating`

## Nimalar sinovdan o‘tkazildi
- `node --check` orqali:
  - `js/app.js`
  - `js/data.js`
  - `js/router.js`
  - `server/server.js`
- Server API qo‘lda sinov qilindi:
  - employer o‘z jobini yozishi
  - worker boshqa employer jobini buzolmasligi
  - application / contract / review yozish
  - derived user metrics qayta hisoblanishi
  - global storage delete 403 qaytarishi

## Eslatma
Bu build best-effort tarzda tuzatildi. Agar xohlasangiz keyingi bosqichda men sizga alohida:
- production uchun tozalangan `README`
- deploy bo‘yicha aniq qadamlar
- qolgan UI polishing ro‘yxatini ham tayyorlab beraman.
