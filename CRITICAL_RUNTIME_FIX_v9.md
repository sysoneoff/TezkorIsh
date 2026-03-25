# TezkorIsh — Critical Runtime Fix v9

Topilgan muammo:
- `updateRoleVisibility()` ichida `renderWorkerDutyCard()` chaqirilgan, lekin bu funksiya umuman yo'q edi.
- Shu sabab `Uncaught Error at updateRoleVisibility` chiqib, onboarding/auth oqimi qotib qolardi.

Tuzatish:
- `renderWorkerDutyCard()` uchun mos wrapper qo'shildi
- `updateRoleVisibility()` endi to'g'ridan-to'g'ri `syncWorkerDutyUI()` ni chaqiradi
- `screen-home` va `section-head` topilmasa ham kod yiqilib tushmasligi uchun null-safe qo'shildi

Natija:
- `Ma'lumotlar` sahifasi endi qotib qolmaydi
- ro'yxatdan o'tish oqimi davom etadi
- worker duty UI runtime error bermaydi
