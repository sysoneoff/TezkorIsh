# TezkorIsh fixed v31

Ushbu versiyada Telegram login ekrani tuzatildi.

## Tuzatishlar
- `btn-telegram-login` uchun alohida `.telegram-auth-btn-wrap` wrapper qo'shildi.
- `renderTelegramLoginOptions()` endi parent card'ni emas, faqat tugma wrapper'ini yashiradi/ko'rsatadi.
- Serverdan Telegram config olish xatosi `try/catch` bilan ushlanadi, sahifa yiqilmaydi.
- Frontend/service worker/server versiyasi `v31` ga yangilandi, eski cache ushlanib qolishini kamaytiradi.

## Natija
- Telegram login kartasi endi yo'qolib ketmaydi.
- Widget chiqmasa ham fallback tugma ko'rinadi.
- Yangi deployda cache yangilanadi.
