TezkorIsh v70 update

- Desktop onboarding/auth screenlarda sidebar yashirildi.
- Placeholder foydalanuvchi ismi endi demo Mansur emas, generic holat.
- Eski/yaroqsiz user localStorage avtomatik inkor qilinadi.
- Auth state AppState.user dan ajratildi.
- Protected screenlar ro'yxatdan o'tmasdan ochilmaydi.

# TezkorIsh 60% audit

## Topilgan asosiy xatolar
1. **Feed logikasi noto'g'ri edi**: `in_progress` ishlar ham worker home feed'da ko'rinib qolishi mumkin edi.
2. **Yopish / bajarildi aralashib ketgan edi**: employer e'lonni yopganda ayrim qabul qilingan workerlar `completed` bo'lib qolishi mumkin edi.
3. **Saqlanganlar menyusi DOM'da yo'q edi**: kod `saved-menu-item` elementini boshqarayotgan edi, lekin element HTML'da yo'q edi.
4. **OTP validatsiyasi formal edi**: barcha katak to'lsa o'tib ketardi, demo kod tekshirilmasdi.
5. **Qabul qilingan e'lonlar ommaviy feed'dan yashirilmagan edi**: Yandex Taxi uslubidagi “band bo'ldi -> boshqalarga ko'rinmasin” oqimi to'liq emas edi.
6. **Worker uchun real start rejimi yo'q edi**: yangi vakantlar kelishi bo'yicha worker “ishga chiqdim” holati bo'lmagan.
7. **Yopilgan/eskirgan e'lonlar local demo bazada uzoq turib qolardi**: bu eski ma'lumot ko'p to'planishiga olib kelardi.
8. **Worker oqimida accepted/in_progress aniq ajratilmagan edi**.
9. **Statuslar yetarli emas edi**: `assigned` bosqichi yo'q edi.
10. **Service worker cache versiyasi eskirgan edi**: yangi versiya bilan cache yangilanishi kerak edi.

## Shu versiyada tuzatilganlari
- public feed endi faqat `active` va muddati o'tmagan vakantlarni ko'rsatadi
- employer qabul qilsa job `assigned` holatiga o'tadi va public feed'dan yashirinadi
- worker accepted ish uchun `Start` bosishi mumkin, shundan keyin job `in_progress` bo'ladi
- employer `close` qilsa accepted app endi noto'g'ri `completed` bo'lib ketmaydi; `job_closed` bo'ladi
- worker uchun `Ishga chiqdim` duty mode qo'shildi
- duty mode yoqilganda yangi vakantlarni local notification bilan ko'rsatish oqimi qo'shildi
- saved menu profilga qo'shildi
- OTP demo kod endi `1234` bo'lishi kerak
- eski hidden ma'lumotlar uchun retention cleanup qo'shildi
- service worker cache versiyasi yangilandi

## Hali production uchun yetishmayotganlar
- Firebase Phone Auth
- Firestore realtime sync
- FCM web push (haqiqiy background push)
- security rules
- admin/moderation backend
- analytics + logging
- crash/error monitoring
