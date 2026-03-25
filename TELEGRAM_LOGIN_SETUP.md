# Telegram Login Setup — TezkorIsh

## Maqsad
Tezkor Ish web/mobile web app bo‘lib qoladi. Telegram faqat login va profil identifikatsiyasi uchun ishlatiladi.

## Asosiy qoida
- login kaliti: `telegram_user_id`
- telefon: profil maydoni

## Frontend callback kutayotgan maydonlar
Frontend query param orqali quyidagilarni qabul qila oladi:
- `telegram_user_id` yoki `tg_user_id` yoki `id`
- `username` yoki `tg_username`
- `first_name`
- `last_name`
- `photo_url`
- `tg_verified=1`

## Misol callback
`https://sizning-domeningiz.uz/?telegram_user_id=123456789&username=sysoneuser&first_name=Ali&last_name=Valiyev&photo_url=https%3A%2F%2F...&tg_verified=1`

## Muhim
Frontend callbackni qabul qiladi, lekin **haqiqiy xavfsizlik backend verification bilan bo‘ladi**. Telegram’dan kelgan hash/auth ma’lumotlari serverda tekshirilishi kerak.

## Tavsiya
1. BotFather’da domain/callbacklarni ulang
2. Backendda Telegram login verify qiling
3. Verify bo‘lgach foydalanuvchini shu query paramlar bilan frontendga qaytaring
4. Frontend profilni to‘ldirishni yakunlaydi
