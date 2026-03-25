# TezkorIsh — Real Pilot v27

Uchko'prik tumani uchun kunlik ishchilar platformasi.

## Ishga tushirish

### Frontend + server
```bash
npm install
npm start
```

### Server env
`server/.env.example` faylidan nusxa olib `.env` yarating va kamida quyilarni to'ldiring:
- `APP_BASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `SESSION_SECRET`

## Muhim
- Telegram auth server-side verify qilinadi.
- Session cookie `HttpOnly` va `SameSite=Lax`.
- Shared data server storage orqali saqlanadi.
