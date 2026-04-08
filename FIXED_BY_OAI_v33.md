# FIXED_BY_OAI_v33

Asosiy tuzatishlar:

1. Telegram login callbackdan keyin eski profil mavjud bo'lsa server endi foydalanuvchini to'g'ridan-to'g'ri login qiladi.
2. `pendingTelegram.existingProfiles` frontendda ham hisobga olinadi, shu sabab role tanlash va prefill ishlaydi.
3. Ichki lokal sinov kartasi production/server buildda default holatda yashirin qilindi.
4. Auth URL query/hash tozalash kuchaytirildi (`tg_new`, `tg_error`, auth hashlar olib tashlanadi).
5. Login qilgan foydalanuvchi auth ekranlariga qayta tushib qolmasligi uchun routerga guard qo'shildi.
6. Cache versiyasi `v33` ga yangilandi.
